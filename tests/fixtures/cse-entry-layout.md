<box border radius="lg" padding={3} gap={2}>
  <title>CSE Data Block Entry</title>
  <box gap="2px">
    {#each [
      {name:"Key Suffix Length",size:"2 B",color:"surface-secondary"},
      {name:"Key Suffix",size:"变长",color:"rgba(55,120,195,0.12)"},
      {name:"Meta",size:"1 B",color:"surface-secondary"},
      {name:"Version",size:"8 B",color:"rgba(44,150,95,0.12)"},
      {name:"Old Version（可选）",size:"8 B",color:"rgba(44,150,95,0.07)"},
      {name:"User Meta Length",size:"1 B",color:"surface-secondary"},
      {name:"User Meta / Value / BlobRef",size:"变长",color:"surface-secondary"}
    ] as x}
      <row justify="between" background={x.color} padding={2} radius="sm">
        <text>{x.name}</text>
        <text size="xs" color="secondary">{x.size}</text>
      </row>
    {/each}
  </box>
  <caption>Entry 字段按以上顺序排列。</caption>
</box>
