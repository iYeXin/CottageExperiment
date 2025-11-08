# Enworlded AI Cottage Experiment

# 环境 AI：小屋实验

A prototype implementation of Environment AI paradigm.

环境 AI 范式的原型实现。

## Experimental Data in The Paper

## 论文中的实验数据

For our original experimental data see: `/digital_cottage_records.json`

我们的原始实验数据参见：`/digital_cottage_records.json`

## Environment requirements

## 环境要求

- Node.js 22+

## Quick Start

## 快速开始

1. Clone and install dependencies
   克隆并安装依赖项

```bash
git clone https://github.com/iyexin/CottageExperiment.git
cd CottageExperiments/src
npm install
```

2. Configure LLM API in `config.js` and start experiment
   在 `config.js` 中配置 LLM API 并启动实验。

```javascript
const openaiConfig = {
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", // current use | 当前实验中使用
  apiKey: process.env.ALI_API || "API_KEY",
  model: "qwen-plus", // current use | 当前实验中使用
  temperature: 0.5,
};
```

```bash
npm run start
```

3. (Optional) Modify world logic and initial parameters, with default configuration consistent with paper experiment configuration.
   (可选) 修改世界逻辑和初始参数，默认配置与论文中进行的实验配置一致

Edit `main.js`, `base/agent.js`, `base/shared-world.js` to customize the environment and agent behaviors.
编辑 `main.js`、`base/agent.js`、`base/shared-world.js` 以自定义环境和智能体行为。

_Note: This is a research prototype for exploring Environment AI concepts._
_注意：这是一个用于探索环境 AI 概念的研究原型。_
