const previewHtml = `<style>
#preview-demo { padding:24px; border:1px solid #e1e3e8; background:#fafbfc; font:14px/1.6 system-ui; }
#preview-demo h2 { margin:0 0 8px; font-size:22px; } #preview-demo button { border:0; background:#292b34; color:white; border-radius:6px; padding:10px 16px; margin:8px 8px 0 0; }
#preview-demo .sample { padding:18px; border:1px solid #e2e4e9; margin:16px 0; background:white; }
</style><section id="preview-demo" aria-label="搜索结果布局"><h2>客户搜索体验</h2><p>调整布局后，将当前版本与选择带回会话。</p><div class="sample">陈晓 · 产品设计<br>刘宁 · 项目协作</div><output id="counter"></output><br><button id="increment">模拟交互</button><button id="follow-up">按此方案继续</button></section>
<script>
const design = {radius:12, accent:'#7865bd', compact:false, density:'comfortable'};
const root = document.getElementById('preview-demo');
let count = window.openai.widgetState?.privateContent?.count || 0;
function render(){root.style.borderRadius=design.radius+'px';root.style.borderColor=design.accent;root.style.padding=design.compact?'12px':'24px';document.getElementById('counter').textContent='已交互 '+count+' 次';}
render();
new Tweak({container:root,onChange:render}).addSlider(design,'radius',{min:0,max:32,label:'圆角',unit:'px'}).addColorPicker(design,'accent',{label:'强调色'}).addToggle(design,'compact',{label:'紧凑布局'}).addSelect(design,'density',{label:'信息密度',options:[{label:'舒适',value:'comfortable'},{label:'紧凑',value:'compact'}]});
document.getElementById('increment').onclick=()=>{count++;render();window.openai.setWidgetState({modelContent:{count},privateContent:{count,secret:'PRIVATE_ONLY'}});};
document.getElementById('follow-up').onclick=()=>window.openai.sendFollowUpMessage({prompt:'采用当前预览的布局继续实现。'});
window.addEventListener('openai:set_globals',()=>{count=window.openai.widgetState?.privateContent?.count||0;render();});
</script>`;
module.exports = { previewHtml };
