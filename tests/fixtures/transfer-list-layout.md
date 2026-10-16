OceanBase 的过程可以概括为：

<box border radius="lg" padding={3}>
  <list marker="number" connector="solid" gap={3}>
    <list-item>
      **准备 Transfer**

      锁定迁移任务，校验源、目标 LS 的成员配置、Tablet 状态与事务状态。
    </list-item>
    <list-item>
      **建立 Source Fence**

      停止向迁移 Tablet 发起新的源端写入，处理正在执行的写入，记录 `Transfer SCN`。
    </list-item>
    <list-item>
      **记录两侧 Transfer 状态**

      源 LS 登记 `START_TRANSFER_OUT`，目标 LS 登记 `START_TRANSFER_IN`，并更新 Tablet 的 LS 映射和 Transfer Sequence。
    </list-item>
    <list-item>
      **补齐目标端 Tablet 数据**

      复用或复制 Tablet 数据文件，处理未完成事务和 SSTable 的事务状态，替换临时的逻辑数据表示。
    </list-item>
    <list-item>
      **完成 Transfer**
    </list-item>
  </list>
</box>
