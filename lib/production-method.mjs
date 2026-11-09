import fs from 'node:fs';

// Read at each use so the next job receives the current approved method.
export function readProductionMethod(){
 return JSON.parse(fs.readFileSync(new URL('./production-method.json',import.meta.url),'utf8'));
}
export function readMethodFile(kind){
 const file=readProductionMethod()[kind].methodFile;
 return fs.readFileSync(new URL(file,import.meta.url),'utf8');
}
export const readCharacterExpressionMethod=()=>readMethodFile('characters');
export function characterExpressionDirection(p,s){
 const index=p.scenes.findIndex(x=>x.id===s.id);
 const nearby=index<0?[]:p.scenes.slice(Math.max(0,index-2),index);
 return `\n人物表情与情节要求（优先于旧风格或旧画面描述中的固定微笑）：\n${readCharacterExpressionMethod()}\n本镜含义：${s.text}\n前面镜头仅供理解情绪发展：${nearby.map(x=>x.text+'；画面：'+(x.prompt||'')).join('\n')||'这是开场或独立镜头'}\n先根据这段具体情节判断每个在场角色的状态，再决定眉眼、嘴形、视线、头部姿态和手势。没有人物时不为展示表情添加人物。`;
}
