const glados = async () => {
  // 检查 GLADOS 环境变量是否存在
  if (!process.env.GLADOS) {
    console.log('GLADOS secret not found, skipping checkin.');
    return null; // 如果没有配置，直接返回 null
  }

  // 将环境变量中的 cookies 按行分割成数组
  const cookies = String(process.env.GLADOS).split('\n').filter(cookie => cookie.trim() !== '');
  if (cookies.length === 0) {
    console.log('GLADOS secret is empty, skipping checkin.');
    return null;
  }

  const notices = [];

  // 遍历所有 cookies 进行签到
  for (const [index, cookie] of cookies.entries()) {
    // 默认账户标识，用于出错时
    let accountIdentifier = `Account #${index + 1}`;
    let notice_body = [];

    try {
      const common_headers = {
        'cookie': cookie,
        'referer': 'https://glados.rocks/console/checkin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      // 1. 执行签到
      const checkin_response = await fetch('https://glados.rocks/api/user/checkin', {
        method: 'POST',
        headers: { ...common_headers, 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'glados.one' }),
      });
      const checkin_result = await checkin_response.json();
      
      // 2. 获取账户状态
      const status_response = await fetch('https://glados.rocks/api/user/status', {
        method: 'GET',
        headers: common_headers,
      });
      const status_result = await status_response.json();

      // 从 status API 的返回结果中获取 email 作为账户标识
      if (status_result?.data?.email) {
        accountIdentifier = status_result.data.email;
      }
      
      // 检查签到和状态API的返回码
      if (checkin_result?.code === -2) {
        // -2 通常表示已经签到过
        notice_body.push(
          `✅ Checkin Already Done`,
          `💬 Message: ${checkin_result.message}`,
          `⏳ Left Days: ${Number(status_result?.data?.leftDays)}`
        );
      } else if (checkin_result?.code === 0) {
        // 0 表示签到成功
        notice_body.push(
          `✅ Checkin OK`,
          `💬 Message: ${checkin_result.message}`,
          `⏳ Left Days: ${Number(status_result?.data?.leftDays)}`
        );
      } else {
        // 其他 code 表示签到失败
        throw new Error(checkin_result.message || 'Unknown checkin error');
      }

    } catch (error) {
      notice_body.push(
        `❌ Checkin Error`,
        `💬 Reason: ${error.message}`,
        `🔗 Link: <${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      );
    }
    
    // 将当前账户的通知内容组合起来
    notices.push(`[${accountIdentifier}]\n` + notice_body.join('\n'));
  }
  
  // 将所有账户的通知用分隔符连接起来
  return notices.join('\n\n---\n\n');
};

const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) return;

  for (const option of String(process.env.NOTIFY).split('\n')) {
    if (!option) continue;
    try {
      if (option.startsWith('console:')) {
        console.log("--- Notification ---");
        console.log(notice);
        console.log("--- End Notification ---");
      } else if (option.startsWith('wxpusher:')) {
        const parts = option.split(':');
        const appToken = parts[1];
        const uids = parts.slice(2);
        await fetch(`https://wxpusher.zjiecode.com/api/send/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            appToken,
            content: notice,
            summary: `GLaDOS Checkin Report`,
            contentType: 1, // 1 for text, 2 for html, 3 for markdown
            uids,
          }),
        });
      } else if (option.startsWith('pushplus:')) {
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option.split(':')[1],
            title: `GLaDOS Checkin Report`,
            content: notice.replace(/\n/g, '<br>'), // pushplus uses <br> for newlines in markdown
            template: 'markdown',
          }),
        });
      } else if (option.startsWith('qyweixin:')) {
        const qyweixinToken = option.split(':')[1];
        const qyweixinNotifyRebotUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + qyweixinToken;
        await fetch(qyweixinNotifyRebotUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
                content: notice,
            },
          }),
        });
      } else {
        // Fallback to pushplus if no prefix
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option,
            title: `GLaDOS Checkin Report`,
            content: notice.replace(/\n/g, '<br>'),
            template: 'markdown',
          }),
        });
      }
    } catch (error) {
      console.error(`Notify Error for option: ${option}`, error);
    }
  }
};

const main = async () => {
  const notice_content = await glados();
  if (notice_content) {
    await notify(notice_content);
  } else {
    console.log("No notice content to send.");
  }
};

main();
