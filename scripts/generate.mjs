// scripts/generate.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chatGLM } from './lib/glm.mjs';

const CORPUS_DIR = path.resolve(import.meta.dirname, '..', 'corpus');

// 尾随内容容错：直接解析失败后，从尾部逐 }/] 位置回退截断再试（移植 Dify merge1 的 raw_decode 语义）
function tryParseValue(s) {
  try { return JSON.parse(s); } catch { /* 继续：尾随内容回退 */ }
  let j = s.length - 1;
  while (j >= 0) {
    if (s[j] === '}' || s[j] === ']') {
      try { return JSON.parse(s.slice(0, j + 1)); } catch { /* 再回退 */ }
    }
    j--;
  }
  return undefined;
}

// 雅思裸数组回退：从每个 [ 位置尝试解析词条数组（首元素含 w 或 word 字段，移植 merge1 的 _find_word_array）
function findWordArray(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '[') continue;
    const v = tryParseValue(s.slice(i));
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && ('w' in v[0] || 'word' in v[0])) {
      return v;
    }
  }
  return null;
}

export function parseCardJson(text) {
  let s = String(text ?? '');
  // ① 剥离 GLM 思考块
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.trim();
  // ② 剥离 markdown 代码围栏
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // ③ 从每个 { 位置尝试解析完整 JSON 对象（容忍前导散文与尾随内容）；
  //    接受含 questions 数组或 words 数组的任意 dict（真实输出为软考 {"questions":[...]} / 雅思 {"words":[...],"listening":{...}} 单键对象）
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    const v = tryParseValue(s.slice(i));
    if (v && typeof v === 'object' && !Array.isArray(v) && (Array.isArray(v.questions) || Array.isArray(v.words))) return v;
  }
  // ④ 雅思裸数组回退
  const arr = findWordArray(s);
  if (arr) return { words: arr };
  throw new Error('输出中找不到合法 JSON');
}

function loadCorpusSnippet(weakPoints, maxChars = 4000) {
  // 关键词+错题加权检索（简化替代向量库）：按 weakPoints 关键词在 corpus 文件里匹配段落
  const files = readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.md'));
  const hit = files.map(f => ({ name: f.name, txt: readFileSync(path.join(CORPUS_DIR, f.name), 'utf8') }))
    .map(f => ({ ...f, score: (weakPoints || []).reduce((s, w) => s + (f.txt.includes(w) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return hit.map(h => `【${h.name}】\n${h.txt.slice(0, 800)}`).join('\n----\n');
}

export async function generateCards({ subject, weakPoints = [], recentContext = '' }) {
  const ruankaoPrompt = readFileSync(path.resolve(import.meta.dirname, '..', 'prompts', 'ruankao.txt'), 'utf8');
  const ieltsPrompt = readFileSync(path.resolve(import.meta.dirname, '..', 'prompts', 'ielts.txt'), 'utf8');
  const snippet = loadCorpusSnippet(weakPoints);
  const ruankaoRaw = await chatGLM([
    { role: 'system', content: ruankaoPrompt },
    { role: 'user', content: `今日薄弱点：${weakPoints.join('、') || '无'}\n检索资料：\n${snippet}\n\n近3天错题归纳：\n${recentContext || '无'}` },
  ], { maxTokens: 8192 });
  const ieltsRaw = await chatGLM([
    { role: 'system', content: ieltsPrompt },
    { role: 'user', content: `今日日期：${new Date().toISOString().slice(0, 10)}` },
  ], { maxTokens: 8192 }); // 雅思 8192：DeepSeek max_tokens 上限 8K，50 词表约 6K tokens 可容纳
  const rk = parseCardJson(ruankaoRaw);
  const ie = parseCardJson(ieltsRaw);
  if (!Array.isArray(rk.questions) || rk.questions.length !== 20) throw new Error(`软考题目数 ${rk.questions?.length}≠20`);
  if (!Array.isArray(ie.words) || ie.words.length < 1) throw new Error('雅思词表为空');
  // 包装为接口形状 {ruankao:{questions}, ielts:{words,listening}}（listening 缺省时回退 ''，同 merge1）
  return { ruankao: { questions: rk.questions }, ielts: { words: ie.words, listening: ie.listening ?? '' } };
}
