// Anonymous sample with the same nested checklist structure as ChatGPT cards.
module.exports = (done = '[]') => [
  '{@body const activities=[{day:"周一",name:"自由阅读",detail:"选择一本书，读一小段，再分享自己的发现",question:"今天读到了什么？"},{day:"周三",name:"交流分享",detail:"轮流讲一个故事，比较不同的理解",question:"你有不同的想法吗？"},{day:"周五",name:"复习笔记",detail:"整理本周的笔记，写下一个新问题",question:"你最想继续了解什么？"},{day:"周末",name:"自由选择",detail:"选择阅读、绘画、散步或自己设计的活动",question:"下次想试什么？"}]}',
  `{@body const [done,setDone]=DIL.useState(${done})}`,
  '<box border radius="xl" padding={3} gap={3}>',
  '  <row align="center" justify="between">**每周阅读计划**<text color="secondary" size="xs" tabularNums>{done.length}/4 已完成</text></row>',
  '  <box background="surface-tertiary" height="5px" radius="full" clip><box background="default" height="100%" width={`${done.length/4*100}%`} radius="full"/></box>',
  '  {#each activities as a,i}',
  '    <row key={a.day} align="start" gap={3}>',
  '      <checkbox checked={done.includes(i)} onChange={v=>setDone(old=>v?[...old,i]:old.filter(x=>x!==i))}/>',
  '      <box flex="1" gap={1}>',
  '        <row align="center" gap={2}><text weight="medium">{a.day} · {a.name}</text></row>',
  '        <text size="sm">{a.detail}</text>',
  '        <text size="xs" color="secondary">引导提问：{a.question}</text>',
  '      </box>',
  '    </row>',
  '  {/each}',
  '  <button block color="secondary" variant="outline" onClick={()=>setDone([])}>重置本周计划</button>',
  '</box>'
].join('\n');
