// --- 常量定义 ---
// 将固定的 URL 和配置放在这里，方便管理
const GITHUB_ACTION_LINK = `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`;
const GLADOS_API = {
  CHECKIN: 'https://glados.rocks/api/user/checkin',
  STATUS: 'https://glados.rocks/api/user/status',
  REFERER: 'https://glados.rocks/console/checkin'
};
const NOTIFY_API = {
  WXPUSHER: 'https://wxpusher.zjiecode.com/api/send/message',
  PUSHPLUS: 'https://www.pushplus.plus/send',
  QYWEIXIN: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='
};

/**
 * 带有超时功能的 fetch 封装
 * @param {string} url 请求 URL
 * @param {object} options fetch 的配置选项
 * @param {number} timeout 超时时间 (毫秒)
 * @returns {Promise<Response>}
 */
const fetchWithTimeout = async (url, options, timeout = 8000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeout / 1000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};


/**
 * GLaDOS 签到函数
 * @returns {Promise<string|null>} 组合好的通知字符串，如果没有配置则返回 null
 */
const glados = async () => {
  if (!process.env.GLADOS) {
    console.log('GLADOS secret not found, skipping checkin.');
    return null;
  }

  const cookies = String(process.env.GLADOS).split('\n').filter(cookie => cookie.trim() !== '');
  if (cookies.length === 0) {
    console.log('GLADOS secret is empty, skipping checkin.');
    return null;
  }

  const notices = [];

  for (const [index, cookie] of cookies.entries()) {
    let accountIdentifier = `Account #${index + 1}`;
    const notice_body = [];

    try {
      const common_headers = {
        'cookie': cookie,
        'referer': GLADOS_API.REFERER,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
      };

      // 1. 执行签到
      const checkin_response = await fetchWithTimeout(GLADOS_API.CHECKIN, {
        method: 'POST',
        headers: { ...common_headers, 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'glados.one' }),
      });
      if (!checkin_response.ok) {
        throw new Error(`Checkin API returned status ${checkin_response.status} ${checkin_response.statusText}`);
      }
      const checkin_result = await checkin_response.json();

      // 2. 获取账户状态
      const status_response = await fetchWithTimeout(GLADOS_API.STATUS, {
        method: 'GET',
        headers: common_headers,
      });
      if (!status_response.ok) {
        throw new Error(`Status API returned status ${status_response.status} ${status_response.statusText}`);
      }
      const status_result = await status_response.json();

      if (status_result?.data?.email) {
        accountIdentifier = status_result.data.email;
      }

      if (checkin_result?.code === -2) {
        notice_body.push(`✅ Checkin Already Done`, `💬 Message: ${checkin_result.message}`, `⏳ Left Days: ${Number(status_result?.data?.leftDays)}`);
      } else if (checkin_result?.code === 0) {
        notice_body.push(`✅ Checkin OK`, `💬 Message: ${checkin_result.message}`, `⏳ Left Days: ${Number(status_result?.data?.leftDays)}`);
      } else {
        throw new Error(checkin_result.message || 'Unknown checkin error from API');
      }

    } catch (error) {
      console.error(`[${accountIdentifier}] Checkin process failed:`, error);
      notice_body.push(`❌ Checkin Error`, `💬 Reason: ${error.message}`, `🔗 Link: ${GITHUB_ACTION_LINK}`);
    }

    notices.push(`[${accountIdentifier}]\n` + notice_body.join('\n'));
  }

  return notices.join('\n\n---\n\n');
};

/**
 * 发送通知
 * @param {string} notice 要发送的通知内容
 */
const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) return;

  const notifyOptions = String(process.env.NOTIFY).split('\n').filter(opt => opt.trim() !== '');

  for (const option of notifyOptions) {
    try {
      if (option.startsWith('console:')) {
        console.log("--- Notification ---\n", notice, "\n--- End Notification ---");
      } else if (option.startsWith('wxpusher:')) {
        const [, appToken, ...uids] = option.split(':');
        await fetchWithTimeout(NOTIFY_API.WXPUSHER, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appToken, content: notice, summary: `GLaDOS Checkin Report`, contentType: 1, uids }),
        });
      } else if (option.startsWith('pushplus:')) {
        const [, token] = option.split(':');
        await fetchWithTimeout(NOTIFY_API.PUSHPLUS, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, title: `GLaDOS Checkin Report`, content: notice.replace(/\n/g, '<br>'), template: 'markdown' }),
        });
      } else if (option.startsWith('qyweixin:')) {
        const [, token] = option.split(':');
        await fetchWithTimeout(NOTIFY_API.QYWEIXIN + token, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msgtype: 'markdown', markdown: { content: notice } }),
        });
      } else { // 默认为 pushplus
        await fetchWithTimeout(NOTIFY_API.PUSHPLUS, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: option, title: `GLaDOS Checkin Report`, content: notice.replace(/\n/g, '<br>'), template: 'markdown' }),
        });
      }
    } catch (error) {
      console.error(`Notify Error for option: ${option.split(':')[0]}`, error);
    }
  }
};

/**
 * 主执行函数
 */
const main = async () => {
  try {
    const notice_content = await glados();
    if (notice_content) {
      await notify(notice_content);
    } else {
      console.log("No notice content generated or no accounts configured. Exiting.");
    }
  } catch (error) {
    console.error("A critical error occurred in the main process:", error);
    // 当发生严重错误时，也尝试发送通知
    const errorMessage = `🚨 **GLaDOS Action Critical Error**\n\nAn unexpected error caused the script to fail:\n\n**Message:**\n${error.message}\n\n**Check Action Log for details:**\n${GITHUB_ACTION_LINK}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    await notify(errorMessage);
    process.exit(1); // 以失败状态码退出，明确标识 Action 失败
  }
};

main();