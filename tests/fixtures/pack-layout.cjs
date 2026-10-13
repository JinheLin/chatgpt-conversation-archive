// Representative literal data, nested slice loops and proportional row segments.
module.exports = `<box border radius="lg" padding={3} gap={2}>
  <text weight="semibold" size="sm">相同的逻辑行空间，不同的物理 Pack 切分</text>
  {@body const columnPacks = [
    {name:"Handle",bounds:[0,1000,2000,3000]},
    {name:"Age (固定长)",bounds:[0,1000,2000,3000]},
    {name:"Name (变长)",bounds:[0,600,1400,2300,3000]}
  ]}
  {#each columnPacks as c}
    <box gap={1} key={c.name}>
      <text weight="medium" size="xs">{c.name}</text>
      <row gap="2px" height="32px">
        {#each c.bounds.slice(1) as end,i}
          <box key={i} flex={end-c.bounds[i]} background={i%2===0?"rgba(75,130,190,0.24)":"rgba(75,130,190,0.42)"} justify="center" align="center" radius="2xs">
            <text size="3xs" color="default">{c.bounds[i]}–{end}</text>
          </box>
        {/each}
      </row>
    </box>
  {/each}
  <row justify="between"><caption>Row 0</caption><caption>Row 3000</caption></row>
</box>`;
