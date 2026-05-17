# 使用场景

## 场景一：家庭智能体网络

家庭成员各有 Agent（NAS、笔记本、树莓派），同在一个局域网。

**工作方式：**
1. 每个 Agent 启动后生成 Ed25519 密钥对，Agent ID 自动包含公钥
2. 通过 mDNS 广播自身，其他 Agent 自动发现并获取 Manifest
3. 首次相遇时 TOFU 钉扎对端密钥
4. Alice 的 Agent 给 Bob 的 Agent 发送签名 `adp:info`："晚饭准备好了"
5. 全部通过局域网直连 + 消息签名验证，不经过外网

**关键协议要素：** mDNS 发现、WebSocket 直连、`adp:info`、Ed25519 签名

---

## 场景二：开发者工具链

Claude Code 写完代码要交给 Codex 做 review，两者不在同一网络。

**工作方式：**
1. 两个 Agent 各自生成密钥对并注册到 Registry
2. Claude Code 通过 Registry 解析 Codex 的路由
3. 双方通过 Relay 中继通信（Relay 无法篡改签名消息）
4. Claude Code 发送签名代码 diff，Codex 返回签名 review 结果
5. 双方通过 TOFU 钉扎对端密钥，消息端到端可验证

**关键协议要素：** Registry 发现、Relay 中继、Ed25519 签名、自定义能力 `custom:code.review`

---

## 场景三：跨组织协作

两家公司的 Agent 需要有限度通信，但不能暴露内网。

**工作方式：**
1. 双方 Agent 通过公网 Relay 通信
2. 所有消息强制 Ed25519 签名验证
3. 首次协作时通过带外渠道比对 Agent ID（如视频通话念公钥、扫描二维码）
4. Manifest 的 `capabilities` 只暴露同意共享的能力
5. 每条消息端点验签——Relay 只转发，无法伪造

**关键协议要素：** Relay 中继、强制签名模式、TOFU + 手动公钥验证、能力声明

---

## 场景四：IoT 边缘网络

摄像头、传感器、门锁各自跑轻量 Agent，设备间直接协同。

**工作方式：**
1. 设备出厂预置密钥对，Agent ID = 公钥 + 命名空间
2. 局域网内通过 mDNS 互相发现，TOFU 钉扎
3. 实现 `adp:ping` + `adp:capability.query` + `adp:info`
4. 传感器检测异常 → 签名 `adp:info` 通知摄像头录像 → 通知门锁锁定
5. 无 Registry、无云中转、无公网暴露
6. 每条指令端点验签，防止伪造传感器数据
7. 电池供电设备声明 `heartbeat_interval: 300`，对端容忍更长静默期

**关键协议要素：** mDNS 发现、WebSocket 直连、Ed25519 签名、标准能力集、可配置心跳
