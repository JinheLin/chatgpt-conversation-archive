{@body const [itemCount,setItemCount] = DIL.useState("4")}
{@body const [groupCount,setGroupCount] = DIL.useState("2")}
{@body const [mode,setMode] = DIL.useState("on")}
{@body const [workers,setWorkers] = DIL.useState("32")}
<box border radius="lg" padding={3} gap={3}>
  <title size="lg">Example configuration</title>
  <text color="secondary" size="xs">Choose an initial configuration.</text>
  <form gap={3} onSubmit={()=>GenUI.issueNewTurn(`Sample request: ${itemCount} items, ${groupCount} groups, ${mode==="on"?"enabled":"disabled"}, ${workers} workers.`)}>
    <grid columns={2} gap={3}>
      <grid-item>
        <label>Items</label>
        <select block value={itemCount} onChange={setItemCount} options={[{label:"1",value:"1"},{label:"2",value:"2"},{label:"4",value:"4"},{label:"8",value:"8"}]}/>
      </grid-item>
      <grid-item>
        <label>Groups</label>
        <select block value={groupCount} onChange={setGroupCount} options={[{label:"1",value:"1"},{label:"2",value:"2"},{label:"4",value:"4"}]}/>
      </grid-item>
      <grid-item>
        <label>Mode</label>
        <select block value={mode} onChange={setMode} options={[{label:"Enabled",value:"on"},{label:"Disabled",value:"off"}]}/>
      </grid-item>
      <grid-item>
        <label>Workers</label>
        <select block value={workers} onChange={setWorkers} options={[{label:"8",value:"8"},{label:"32",value:"32"},{label:"128",value:"128"}]}/>
      </grid-item>
    </grid>
    {#if Number(groupCount)>Number(itemCount)}
      <text color="danger" size="xs">Check the group count.</text>
    {/if}
    <button block submit disabled={Number(groupCount)>Number(itemCount)}>Create a plan <icon name="arrow-right" inline/></button>
  </form>
</box>
