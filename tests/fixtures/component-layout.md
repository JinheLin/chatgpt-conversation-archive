## Component compatibility

<box border radius="lg" padding=3 gap=1>
  <row gap=2>
    <box background="surface-secondary" align="center"><title>2020</title><caption>Example</caption></box>
    <box><text>**Paper A**</text><Link title="Read PDF" url="https://example.com/paper.pdf"/> · <Link url="https://example.com/doi" title="DOI"/></box>
  </row>
  <Cite refs={["turn1search0"]}/>
  <box background="surface-secondary" padding={3} gap=1>
    **First stage**
    <caption>Keep the first stage's description</caption>
    <box background="surface-secondary" padding={3} gap=1>
      **Second stage**
      <caption>Keep the nested description</caption>
    </box>
  </box>
  <row gap="3px" height="38px">
    <box flex={2} radius={{topLeft:"sm",bottomLeft:"sm"}} background="#377eb8"><text>Stored</text></box>
    <box flex={1.5} background="#d17c27"><text>Pending</text></box>
    <box flex={1} radius={{topRight:"sm",bottomRight:"sm"}} background="surface-tertiary"><text>Free</text></box>
  </row>
  <row gap={1}>
    {#each Array.from({length:16},(_,i)=>i) as i}
      <box flex="1" height="16px" radius="xs" background={[1,4,11].includes(i)?"#377eb8":"surface-tertiary"}/>
    {/each}
  </row>
</box>

<Chart content={{"chartType":"bar","meta":{"title":"Example timings","description":"Seconds; lower is better."},"xKey":"step","series":[{"dataKey":"a","label":"Plan A","valueSuffix":" s"},{"dataKey":"b","label":"Plan B","valueSuffix":" s"},{"dataKey":"c","label":"Plan C","valueSuffix":" s"}],"data":[{"step":"Snapshot","a":0.5,"b":50,"c":1},{"step":"Backup","a":40,"b":50,"c":45},{"step":"Restore","a":1,"b":55,"c":48}]}}/>

Final passage.
