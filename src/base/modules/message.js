// modules/message.js
module.exports = async function messageModule(ctx) {
    // 记录当前步骤
    if (ctx.status === 'EXECUTING') {
        const planDescriptions = ctx.execution.plan.map(action => {
            const fullToolName = action.function;
            const parameters = action.parameters || {};

            // 简化参数显示，避免过长
            const simplifiedParams = {};
            for (const [key, value] of Object.entries(parameters)) {
                if (typeof value === 'string' && value.length > 50) {
                    simplifiedParams[key] = `${value.substring(0, 47)}...`;
                } else if (typeof value === 'object' && value !== null) {
                    simplifiedParams[key] = '[Object]';
                } else {
                    simplifiedParams[key] = value;
                }
            }

            return `${fullToolName}(${JSON.stringify(simplifiedParams)})`;
        });

        ctx.message.steps.push(`执行功能: ${planDescriptions.join(', ')}`);
    } else if (ctx.status === 'ANALYZING') {
        ctx.message.steps.push('分析中...');
    }

    // 检查是否有资源引用，如果有，在最终响应中包含资源信息
    const resourceRefs = ctx.getResourceReferences();
    if (resourceRefs.length > 0 && ctx.status === 'COMPLETED') {
        const resourceInfo = resourceRefs.map(ref =>
            `- ${ref.id}: ${ref.description || '无描述'} (引用计数: ${ref.referenceCount})`
        ).join('\n');

        if (typeof ctx.message.finalResponse === 'string') {
            ctx.message.finalResponse += `\n\n**资源引用信息:**\n${resourceInfo}`;
        }
    }

    // 如果完成，构建最终回复
    if (ctx.status === 'COMPLETED') {
        ctx.message.finalResponse = ctx.message.finalResponse || '操作完成';
    } else if (ctx.status === 'FAILED') {
        ctx.message.finalResponse = `错误: ${ctx.error}`;

        // 如果有资源引用，在错误响应中也包含资源信息
        const resourceRefs = ctx.getResourceReferences();
        if (resourceRefs.length > 0) {
            const resourceInfo = resourceRefs.map(ref =>
                `- ${ref.id}: ${ref.description || '无描述'} (引用计数: ${ref.referenceCount})`
            ).join('\n');

            ctx.message.finalResponse += `\n\n**资源引用信息:**\n${resourceInfo}`;
        }
    }

    // 记录当前状态到步骤历史
    const statusMap = {
        'PENDING': '待处理',
        'ANALYZING': '分析中',
        'EXECUTING': '执行中',
        'COMPLETED': '已完成',
        'FAILED': '已失败'
    };

    ctx.message.steps.push(`状态: ${statusMap[ctx.status] || ctx.status}`);
};
