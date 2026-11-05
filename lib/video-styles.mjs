import {DEFAULT_STYLE} from './costume.mjs';
export const EDUCATION_STYLE='education-cards';
export const isEducation=p=>p.visualStyle===EDUCATION_STYLE;
export const STYLE_PRESETS=[
 {id:'story',name:'故事插画',description:'人物与场景叙事，适合观点、故事和家长共鸣。',tags:'校园插画 · 沉浸运镜',prompt:DEFAULT_STYLE,motion:'push',image:'/assets/styles/story.jpg'},
 {id:EDUCATION_STYLE,name:'教育图解',description:'图形、图标与人物讲清含义，底部字幕承接口播。',tags:'视觉讲解 · 底部字幕',prompt:'清爽教育图解插画，米白底、青蓝强调、深蓝轮廓、少量暖黄色。每镜用图形、图标、时间轴、对比关系或自然的家长与学龄孩子动作解释旁白含义。视觉主体占据主要画面，避免把图解缩在角落或用整段文字复述旁白。人物按需出现，不使用小龙、吉祥物、低幼卡通、Logo、品牌名或陪练提示。横屏16:9，无字幕、无水印、无可读文字。',motion:'still',image:'/assets/styles/education-diagram-v3.jpg',preview:'/assets/styles/education-diagram-v3.mp4'}
];
export function stylePreset(id){return STYLE_PRESETS.find(x=>x.id===id);}
export const educationReference='shared/styles/education-diagram-reference-v3.png';
export function educationReferences(p,sceneId){
 const previous=p.scenes.find(s=>s.id!==sceneId&&s.image&&s.imageStyle===EDUCATION_STYLE&&s.imageStyleVersion===3);
 return [educationReference,...(previous?[previous.image]:[])];
}
