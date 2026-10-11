# 代理操作规则

每次改动都按这个顺序做完，不要停在中间：

1. 修改
2. 测试
3. 提交
4. 推送
5. 更新本地插件

## 测试

修改完成后运行 `npm test`。测试失败时不要提交，先修好再重新测试。

## 提交和推送

- 提交本次相关文件。不要提交密钥、`.env` 或本地导出文件。
- 不要改 git 配置，不要跳过钩子，不要强推。
- 提交说明用一句祈使句，说明为什么改。
- 推送到当前分支的 `origin`。

## 更新本地插件

这个仓库在本机以未打包扩展加载，位于 Google Chrome 配置文件 `Profile 3`（名称 Jinhe）。扩展 ID 是 `pekehafmbhgiibjijbdpjdehaapcchkm`。

推送之后重新加载这个扩展，让磁盘上的新文件生效：

- 在 `chrome-extension://pekehafmbhgiibjijbdpjdehaapcchkm/print.html` 执行 `chrome.runtime.reload()`。
- 或打开 `chrome://extensions/?id=pekehafmbhgiibjijbdpjdehaapcchkm`，点击「重新加载」。

不要退出 Chrome 来加载新文件。这个配置文件不会在启动时恢复标签页。扩展重新加载后，刷新已经打开的阅读器页面。
