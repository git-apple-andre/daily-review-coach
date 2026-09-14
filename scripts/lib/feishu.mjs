// scripts/lib/feishu.mjs
// 飞书客户端：tenant_access_token（缓存 7000s）+ 卡片/告警发送 + 晨间三卡 / 晚间复盘卡 payload
// 卡片 payload 逐字段移植自部署版（20260909-fix 备份）：
//   晨间：W1-patched.json 组装晨间卡片 → buildRuankaoCard / 组装单词听力卡 → buildIeltsCard / 组装晨间打卡卡 → buildMorningFormCard
//   晚间：W2-export.json 组装晚间卡片 → buildEveningCard（Task 6 实现）
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
const TOKEN_TTL_MS = 7000 * 1000;

let _tokenCache = { token: null, expiresAt: 0 };

/** 获取 tenant_access_token（模块级缓存 7000 秒；token 值绝不写入日志/错误信息） */
export async function getTenantToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID/FEISHU_APP_SECRET 未设置');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!res.ok) throw new Error(`飞书 token 请求失败: HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`飞书 token 获取失败: code ${j.code} ${j.msg || ''}`);
  _tokenCache = { token: j.tenant_access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return j.tenant_access_token;
}

/** 发消息（卡片或文本）；不因 HTTP 错误状态抛异常，返回 {statusCode, body} 由调用方判断 */
async function postMessage(chatId, msgType, content) {
  const token = await getTenantToken();
  const res = await fetch(MESSAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: msgType, content }),
  });
  let body = null;
  try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
  return { statusCode: res.status, body };
}

/** 发送卡片消息（msg_type=interactive，content 为卡片 JSON 字符串） */
export async function sendCard(chatId, cardJson) {
  return postMessage(chatId, 'interactive', cardJson);
}

/** 发送纯文本告警（替代 W5「发送告警」：msg_type=text，content=JSON.stringify({text})） */
export async function sendAlert(chatId, text) {
  return postMessage(chatId, 'text', JSON.stringify({ text }));
}

// ---------- 卡片 payload 组装（逐字段移植 W1，含 disabled 自动带出字段） ----------

const md = (content) => ({ tag: 'markdown', content });
const el = (name, label, ph) => ({
  tag: 'input', name,
  label: { tag: 'plain_text', content: label },
  default_value: '',
  placeholder: { tag: 'plain_text', content: ph || '' },
});
const multi = (name, ph, opts) => ({
  tag: 'multi_select_static', name,
  placeholder: { tag: 'plain_text', content: ph },
  options: opts.map((t) => ({ text: { tag: 'plain_text', content: t }, value: t })),
});

/** 软考题目作答卡（schema 2.0，20 个作答栏 + form_submit；含单题/失败回退） */
export function buildRuankaoCard(cards, prep) {
  const rk = cards && cards.ruankao;
  const qs = (rk && Array.isArray(rk.questions)) ? rk.questions : [];

  const elements = [];
  if (qs.length) {
    elements.push(md(`📝 **今日日记已创建**：${prep.noteName || ''}\n\n**📚 软考每日 ${qs.length} 题**\n每题下方作答栏填答案（A/B/C/D），交卷即自动判分，错题进晚间复盘归纳`));
    const formElems = [
      { tag: 'input', name: 'note_date', label: { tag: 'plain_text', content: '日期（自动带出，勿改）' }, default_value: prep.date, disabled: true },
      { tag: 'input', name: 'form_type', label: { tag: 'plain_text', content: '类型（自动带出，勿改）' }, default_value: 'ruankao', disabled: true },
    ];
    qs.forEach((q, i) => {
      formElems.push({ tag: 'div', text: { tag: 'lark_md', content: `**${i + 1}.〔${q.topic}〕${q.question}**\n${(q.options || []).join('\n')}` } });
      formElems.push(el(`q${i + 1}`, `✏️ 第 ${i + 1} 题答案`, '填 A / B / C / D'));
    });
    formElems.push({ tag: 'button', text: { tag: 'plain_text', content: '✅ 交卷 · 自动判分并写回' }, action_type: 'form_submit', name: 'submit_btn' });
    elements.push({ tag: 'form', name: 'ruankao_form', elements: formElems });
  } else if (rk && rk.question) {
    elements.push(md(`**📚 软考每日一题 · ${rk.topic}**\n${rk.question}\n${(rk.options || []).join('\n')}\n\n*答案今晚 20:00 复盘卡揭晓*`));
  } else {
    elements.push(md('📚 软考题目今日生成失败，稍后可在笔记中查看'));
  }

  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `☀️ 晨间卡片 · ${prep.date} ${prep.weekday}` },
      subtitle: { tag: 'plain_text', content: `今日 ${qs.length || 1} 题 · 作答后交卷自动判分` },
    },
    body: { elements },
  };
}

/** 单词与听力卡（与 W1 部署版一致：无 schema 字段、elements 置顶的 1.0 形态） */
export function buildIeltsCard(cards, prep) {
  const ie = cards && cards.ielts;

  const LINKS = '[BBC 6 Minute English](https://www.bbc.co.uk/learningenglish/english/features/6-minute-english) ｜ [ESL Fast 分级听力](https://www.eslfast.com/) ｜ [雅思备考词汇库](https://hefengxian.github.io/my-ielts/)';

  let content = '';
  const ls = (ie && ie.listening) || {};
  content += `**🎧 今日听力任务**（${ls.minutes || 15} 分钟 · ${ls.type || '精听'}）\n${ls.topic || ''}\n方法：${ls.tip || '先盲听抓大意，再逐句精听'}\n直达：${LINKS}\n\n---\n\n`;

  if (ie && Array.isArray(ie.words) && ie.words.length) {
    content += `**🇬🇧 雅思 ${ie.words.length} 词 · 今日词表**（词根拆解 + 完整释义 + 例句）\n`;
    ie.words.forEach((w, i) => {
      content += `${i + 1}. **${w.w}** ${w.ph || ''}\n　词根：${w.rt || '—'}　｜　${w.def || ''}\n　例：${w.st || ''}${w.st_cn ? '（' + w.st_cn + '）' : ''}${w.c ? '　｜　搭配：' + w.c : ''}\n`;
    });
    content += `\n🌙 晚间复盘卡附「单词记忆自测」：10 个词看释义拼写，自动判分\n`;
  } else if (ie && ie.word) {
    content += `**🇬🇧 雅思今日卡 · ${ie.word}** /${ie.phonetic}/\n${ie.definition_cn}\n例句：${ie.example_en}\n听力提示：${ie.listening_tip}\n搭配：${(ie.collocations || []).join('；')}\n\n`;
  } else {
    content += `🇬🇧 雅思词表今日生成失败，稍后可在笔记中查看\n\n`;
  }

  return {
    config: { update_multi: true },
    header: {
      template: 'green',
      title: { tag: 'plain_text', content: `🇬🇧 单词与听力 · ${prep.date}` },
    },
    elements: [{ tag: 'markdown', content }],
  };
}

/** 晨间打卡卡（七只青蛙）：schema 2.0，作息/锻炼/七青蛙/生活 todo + form_submit */
export function buildMorningFormCard(prep) {
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `☀️ 晨间打卡 · ${prep.date} ${prep.weekday}` },
      template: 'green',
      subtitle: { tag: 'plain_text', content: '提交即写入今日日记（青蛙/生活todo/作息/锻炼）' },
    },
    body: { elements: [
      md('花 1 分钟填完这张卡，今天的日记骨架就立好了 🌱'),
      { tag: 'form', name: 'morning_form', elements: [
        { tag: 'input', name: 'note_date', label: { tag: 'plain_text', content: '日期（自动带出，勿改）' }, default_value: prep.date, disabled: true },
        { tag: 'input', name: 'form_type', label: { tag: 'plain_text', content: '类型（自动带出，勿改）' }, default_value: 'morning', disabled: true },
        md('**🌙 昨夜 & 今晨（作息记录）**'),
        el('bedtime', '昨夜入睡时间', '如 23:10'),
        el('last_night', '睡前活动/饮食', '如 刷手机 / 无夜宵'),
        el('wake_time', '今早起床时间', '如 07:20'),
        el('weight', '体重（kg）', '如 79.8'),
        md('**🏃 晨间锻炼**'),
        multi('exercise', '勾选完成的锻炼', ['哑铃', '跑步', '拉伸', '胯下击掌', '步行通勤', '今日休息']),
        md('**🐸 今日七只青蛙**（1 红 + 1 黄 + 5 绿，写最重要的 7 件事）'),
        el('frog_1', '🔴 青蛙 1（红 · 最重要）', '一句话即可'),
        el('frog_2', '🟡 青蛙 2（黄）', ''),
        el('frog_3', '🟢 青蛙 3（绿）', ''),
        el('frog_4', '🟢 青蛙 4（绿）', ''),
        el('frog_5', '🟢 青蛙 5（绿）', ''),
        el('frog_6', '🟢 青蛙 6（绿）', ''),
        el('frog_7', '🟢 青蛙 7（绿 · 可选）', ''),
        md('**🏠 生活 todo**（多项用逗号分隔）'),
        el('life_todos', '生活事项', '如：处理房贷, 取快递, 给爸妈打电话'),
        { tag: 'button', text: { tag: 'plain_text', content: '✅ 提交晨间打卡 · 写入 Obsidian' }, action_type: 'form_submit', name: 'submit_btn' },
      ] },
    ] },
  };
}

/** W2 版 multi：选项为 [text, value] 对（value 与展示文本不同，如 frog_0）；与晨间卡 multi（纯文本列表）不同 */
const multiPairs = (name, ph, opts) => ({
  tag: 'multi_select_static', name,
  placeholder: { tag: 'plain_text', content: ph },
  options: opts.map(([text, value]) => ({ text: { tag: 'plain_text', content: text }, value })),
});

/**
 * 晚间复盘卡（schema 2.0，逐字段移植 W2「组装晚间卡片」，部署版 20260909-fix/W2-export.json）
 * 顶部：20 题答案揭晓 + 交卷成绩/错题归纳 + 今日词库/听力 + 核心策略；
 * 表单：青蛙/生活 todo 勾选 + 身体精神 + 三省 4 问 + 单词记忆自测 10 题 + 学习量化。
 * data = { prep:{date,weekday}, ...W2「提取数据」ex }（frogs/lifeTodos/sampleIelts/rkFull/rkUser/ruankao/ielts/strategy）
 */
export function buildEveningCard(data) {
  const prep = data.prep || {};
  const ex = data; // 与 W2 一致：ex.* 即 data 顶层字段

  // ===== 卡片顶部：答案揭晓 + 交卷成绩 + 错题归纳（W2 逐字） =====
  let top = '';
  const rkFull = ex.rkFull;
  if (rkFull && Array.isArray(rkFull.questions)) {
    const qs = rkFull.questions;
    const key = qs.map((q, i) => `${i + 1}-${q.answer}`).join('  ');
    top += `**📚 今日 ${qs.length} 题答案：**${key}\n完整解析与口诀已写入笔记「软考高项」节\n\n`;
    const rkUser = ex.rkUser;
    if (rkUser && rkUser.total) {
      top += `📝 **今日交卷 ${rkUser.score}/${rkUser.total}**`;
      if (Array.isArray(rkUser.unanswered) && rkUser.unanswered.length) top += `（${rkUser.unanswered.length} 题未作答）`;
      top += '\n';
      if (Array.isArray(rkUser.wrong) && rkUser.wrong.length) {
        rkUser.wrong.forEach((w) => {
          const q = qs[w.n - 1] || {};
          top += `❌ 第${w.n}题〔${w.topic || q.topic || ''}〕：你选 ${w.user}，正确 **${w.correct}** — ${w.analysis || q.analysis || ''}\n`;
        });
        top += `\n下方「错题归纳」填错因与盲区，明早 Dify 出题会重点照顾 💪\n`;
      } else if (rkUser.score === rkUser.total) {
        top += `🎉 全对！今天的状态很好\n`;
      }
      top += '\n';
    } else {
      top += `📝 今日未在晨卡交卷（交卷后这里自动生成错题归纳）\n\n`;
    }
  } else if (ex.ruankao) {
    // 旧格式回退（无 ruankao_json 隐藏注释时用 frontmatter 答案卡）
    const rk = ex.ruankao;
    if (Array.isArray(rk.questions)) {
      const key = rk.questions.map((q, i) => `${i + 1}-${q.answer}`).join('  ');
      top += `**📚 今日 ${rk.questions.length} 题答案：**${key}\n完整解析与口诀已写入笔记「软考高项」节\n\n`;
    } else if (Array.isArray(rk.answers)) {
      const key = rk.answers.map((a, i) => `${i + 1}-${a}`).join('  ');
      top += `**📚 今日 ${rk.answers.length} 题答案：**${key}\n完整解析与口诀已写入笔记「软考高项」节\n\n`;
    } else if (rk.answer) {
      top += `**📚 今日软考题答案：${rk.answer}**\n${rk.analysis || ''}\n`;
      if (rk.memory_hook) top += `🧠 记忆钩子：${rk.memory_hook}\n`;
      top += '\n';
    }
  }
  if (ex.ielts) {
    const ie = ex.ielts;
    if (ie.words_n) {
      top += `**🇬🇧 今日 ${ie.words_n} 词已入库**（完整词表见笔记「英语学习」节）\n`;
      if (ie.listening) top += `🎧 听力任务：${ie.listening}\n`;
      top += '\n';
    } else if (Array.isArray(ie.words) && ie.words.length) {
      top += `**🇬🇧 今日 ${ie.words.length} 词已入库**（完整词表见笔记「英语学习」节）\n\n`;
    } else if (ie.word) {
      top += `**🇬🇧 今日词汇回顾：${ie.word}** — ${ie.definition_cn || ''}\n\n`;
    }
  }
  if (ex.strategy) top += `> 🎯 今日核心策略：${ex.strategy}\n\n`;
  top += '---';

  // ===== 表单选项（W2：勾选项 value 为 frog_i/life_i 索引，W3 写回按此定位） =====
  const frogs = ex.frogs || [];
  const lifeTodos = ex.lifeTodos || [];
  const sampleIelts = ex.sampleIelts || [];

  const frogOpts = frogs.map((f, i) => [`${f.done ? '✅' : f.color} ${f.name}`, `frog_${i}`]);
  if (!frogOpts.length) frogOpts.push(['（今日未列任务）', 'none']);
  const lifeOpts = lifeTodos.map((t, i) => [`${t.done ? '✅' : '○'} ${t.name}`, `life_${i}`]);
  if (!lifeOpts.length) lifeOpts.push(['（今日无生活todo）', 'none']);

  const formElems = [
    { tag: 'input', name: 'note_date', label: { tag: 'plain_text', content: '日期（自动带出，勿改）' }, default_value: prep.date, disabled: true },
    { tag: 'input', name: 'form_type', label: { tag: 'plain_text', content: '类型（自动带出，勿改）' }, default_value: 'evening', disabled: true },
    md('**✅ 工作任务**（勾选今天完成的）'),
    multiPairs('frogs_done', '勾选已完成的工作任务', frogOpts),
    md('**🏠 生活 todo**（勾选今天完成的）'),
    multiPairs('life_done', '勾选已完成的生活事项', lifeOpts),
    md('**🏃 身体与精神**'),
    el('exercise_done', '今日身体活动', '如 哑铃1组+快走30min'),
    el('reading_done', '精神阅读', '如 《XXX》30页'),
    md('**🔍 今日三省**'),
    el('reflect_1', '🎉 成就感/开心事'),
    el('reflect_2', '✨ 我问了AI什么'),
    el('reflect_3', '⚠️ 卡点/如何改进'),
    el('reflect_4', '✨ 改进与明日动作'),
    md('**🇬🇧 单词记忆自测**（看释义拼单词，写完一起提交，自动判分）'),
  ];
  if (sampleIelts.length) {
    sampleIelts.forEach((w, i) => {
      formElems.push(el(`ie_w${i + 1}`, `${i + 1}. ${w.def || ''}〔${w.rt || ''}〕`, '拼写英文单词'));
    });
  } else {
    formElems.push(md('（今日词表不可用，跳过本项）'));
  }
  formElems.push(
    md('**📚 学习量化**（30 秒填完）'),
    el('rk_input_val', '软考·刷题量', '如 20题 + 第5章'),
    el('rk_mistake_val', '软考·错题归纳（错因+盲区）', '如 第3题混淆了关键路径与关键链…'),
    el('ie_listen_val', '雅思·听力', '如 精听25min'),
    el('ie_words_val', '雅思·词汇', '如 50词完成/20词'),
    { tag: 'button', text: { tag: 'plain_text', content: '✅ 提交复盘 · 写入 Obsidian' }, action_type: 'form_submit', name: 'submit_btn' },
  );

  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `🌙 晚间复盘卡 · ${prep.date} ${prep.weekday}` },
      template: 'indigo',
      subtitle: { tag: 'plain_text', content: '3 分钟填完，提交即写入 Obsidian' },
    },
    body: { elements: [
      md(top),
      { tag: 'form', name: 'review_form', elements: formElems },
    ] },
  };
}
