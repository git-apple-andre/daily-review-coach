// scf/feishu-callback/grade.mjs — 判分模块（独立文件供单测）
// 移植源：n8n W3-飞书回调-写回笔记.json「重建笔记(交卷)」判分段 +「重建笔记(晚间)」单词自测判分段（20260909-fix 部署版）
// 数据引用改写：$json.data/$json.body、$('防重放').first().json → 函数参数；纯函数返回，不做文本写回（写回在 rebuild.mjs）

/**
 * 软考判分：逐题比对 answers（W3 逐字：统一大写 + trim；未作答入 unanswered 不计错）。
 * @param {Array} questions 全量题目（topic/question/options/answer/analysis，来自笔记 ruankao_json 隐藏注释）
 * @param {string[]} userAnswers 用户答案数组（索引对齐题目序号；通常由 fv.q1..q20 组装）
 * @returns {{score:number,total:number,wrong:Array<{n:number,user:string,correct:string,topic:string,analysis:string}>,unanswered:number[]}}
 */
export function gradeRuankao(questions, userAnswers) {
  const qs = questions || [];
  const wrong = [];
  const unanswered = [];
  let score = 0;
  qs.forEach((q, i) => {
    const u = String(userAnswers[i] || '').trim().toUpperCase();
    if (!u) { unanswered.push(i + 1); return; }
    if (u === String(q.answer || '').trim().toUpperCase()) score++;
    else wrong.push({ n: i + 1, user: u, correct: q.answer, topic: q.topic || '', analysis: q.analysis || '' });
  });
  return { score, total: qs.length, wrong, unanswered };
}

/**
 * 单词自测判分：看释义拼英文（W3 逐字：每 5 词取 1 采样最多 10 题；比对 trim + toLowerCase）。
 * 未作答跳过不计分；wrong 记录正确拼写（W3 原语义）。
 * @param {Array} words 全量词表（w/def/rt…，来自笔记 ielts_json 隐藏注释）
 * @param {Object} fv 表单值（ie_w1..ie_w10）
 * @returns {{score:number|null,total:number,wrong:string[]}} score 为 null 表示一题未答（W3 原语义）
 */
export function gradeWords(words, fv) {
  const wordsFull = words || [];
  let wordScore = null;
  const wordWrong = [];
  const sample = wordsFull.filter((_, i) => i % 5 === 0).slice(0, 10);
  sample.forEach((w, i) => {
    const u = String(fv['ie_w' + (i + 1)] || '').trim().toLowerCase();
    if (!u) return;
    if (u === String(w.w || '').trim().toLowerCase()) wordScore = (wordScore ?? 0) + 1;
    else wordWrong.push(w.w);
  });
  return { score: wordScore, total: sample.length, wrong: wordWrong };
}
