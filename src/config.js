// 系统配置 - 小屋实验
module.exports = {
    openaiConfig: {
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',  // 阿里云
        apiKey: process.env.ALI_API || 'API_KEY',  // 从环境变量获取API密钥
        model: 'qwen-plus',  // 小屋实验使用模型  基于 2025-11-03 日
        temperature: 0.5
    },
}