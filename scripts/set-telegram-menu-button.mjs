const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const miniAppUrl = String(process.env.TELEGRAM_MINI_APP_URL || process.argv[2] || "").trim();
const buttonText = String(process.env.TELEGRAM_MENU_BUTTON_TEXT || "Play NES").trim();

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

if (!miniAppUrl) {
  console.error("Missing TELEGRAM_MINI_APP_URL");
  process.exit(1);
}

async function callBotApi(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram API ${method} failed`);
  }

  return result;
}

await callBotApi("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: buttonText,
    web_app: {
      url: miniAppUrl,
    },
  },
});

console.log(`Telegram menu button set to ${miniAppUrl}`);
