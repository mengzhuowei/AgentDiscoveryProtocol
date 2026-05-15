# ADP 项目路线图

**更新：** 2026-05-15
**版本：** v0.1（草案阶段）

---

## 阶段一：协议定稿（当前阶段）

目标：将 ADP 协议规范从草案打磨至可供实现的稳定版本。

- [x] 协议规范 review 与完善
- [x] 补充缺失的协议文档（安全、Relay、隐私、任务状态机、消息签名、版本协商、统一配置）
- [x] 增加更多用例场景说明
- [ ] 公开征集反馈
- [ ] 兼容性测试套件定义

## 阶段二：参考实现

目标：提供至少一套可运行的参考实现，验证协议可行性。

- [ ] **SDK** — TypeScript/Node.js 参考实现（`adp-gateway`）
- [ ] **Registry** — Registry 服务参考实现（MySQL + Redis）
- [ ] **Relay** — Relay 中继节点参考实现
- [ ] **Demo** — 两个 Agent 互相发现与通信的演示

## 阶段三：生态建设

目标：降低接入门槛，建立开发者社区。

- [ ] 发布 npm 包 `adp-gateway`
- [ ] Docker 一键部署（Registry + Relay）
- [ ] 多语言 SDK（Python、Go、Rust）
- [ ] 公开 Registry 实例（`registry.adp.io`）
- [ ] 开发者文档站点

## 阶段四：协议演进

目标：根据实际使用反馈，扩展协议能力。

- [ ] 端到端加密（E2EE）
- [ ] 分布式 Registry（分片 / 一致性哈希）
- [ ] Agent 间高级工作流编排（多步 DAG、条件分支）——基本任务委派已在 v0.1 定义
- [ ] 文件传输通道
- [ ] 身份与信任体系（DID / 证书）

---

## 非目标（明确不做）

- ADP 不定义 Agent 内部的实现方式
- ADP 的 Registry 不存储或转发消息内容（仅注册与寻址；Relay 的临时缓存除外，见 [14-relay-protocol.md](14-relay-protocol.md)）
- ADP 不强制中心化治理
