(() => {
  if (localStorage.getItem("sniffer_enabled") === "false") {
    console.log("🔕 Сниффер отключён");
    return;
  }

  const RealWebSocket = window.WebSocket;

  function SniffedWebSocket(...args) {
    const ws = new RealWebSocket(...args);
    console.log("✅ Подключен к WebSocket:", args[0]);

    const originalSend = ws.send;
    ws.send = function (...args) {
      return originalSend.apply(this, args);
    };

    const origAddEventListener = ws.addEventListener;
    ws.addEventListener = function (type, listener, options) {
      if (type === "message") {
        const wrapped = function (event) {
          handleIncoming(event);
          return listener.call(this, event);
        };
        return origAddEventListener.call(this, type, wrapped, options);
      }
      return origAddEventListener.call(this, type, listener, options);
    };

    Object.defineProperty(ws, "_onmessage_internal", {
      value: null,
      writable: true,
    });

    Object.defineProperty(ws, "onmessage", {
      get() {
        return ws._onmessage_internal;
      },
      set(fn) {
        const wrapped = function (event) {
          handleIncoming(event);
          return fn.call(this, event);
        };
        ws._onmessage_internal = wrapped;
        RealWebSocket.prototype.__lookupSetter__("onmessage").call(ws, wrapped);
      },
      configurable: true,
    });

    return ws;
  }

  const stats = {
    mode_all_1000: {
      accepted: 0,
      skipped: 0,
      label: "🟢 От 1000 юаней и выше",
    },
    mode_half_700_1000: {
      accepted: 0,
      skipped: 0,
      label: "🟡 От 700 до 1000 юаней",
    },
    mode_third_under_700: { accepted: 0, skipped: 0, label: "🔴 До 700 юаней" },
    mode_3: { accepted: 0, skipped: 0, label: "🌐 Все сделки (без фильтра)" },
  };

  function logStatistics() {
    console.log("📊 Статистика по режимам:");
    for (const [mode, data] of Object.entries(stats)) {
      const total = data.accepted + data.skipped;
      if (total === 0) continue;
      const acceptedPercent = ((data.accepted / total) * 100).toFixed(1);
      const skippedPercent = ((data.skipped / total) * 100).toFixed(1);
      console.log(
        `  • ${data.label}: ✅ ${data.accepted} (${acceptedPercent}%) | ❌ ${data.skipped} (${skippedPercent}%)`
      );
    }
  }

  async function handleIncoming(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.event !== "event.deals.auctioned") return;

      const dealId = data.payload?._id;
      const account = data.payload?.credentials?.accountNumber || "";
      const payout = data.payload?.out?.client || 0;
      if (!dealId) return;

      let modes = JSON.parse(localStorage.getItem("sniffer_modes") || "[]");
      if (modes.length === 0) {
        modes = ["mode_3"];
        localStorage.setItem("sniffer_modes", JSON.stringify(modes));
        console.log(
          "⚙️ Фильтр не задан — активирован режим: 🌐 Все сделки (без фильтра)"
        );
      }

      let shouldAccept = false;
      let matchedMode = null;

      if (modes.includes("mode_all_1000") && payout >= 1000) {
        shouldAccept = true;
        matchedMode = "mode_all_1000";
      }

      if (
        !shouldAccept &&
        modes.includes("mode_half_700_1000") &&
        payout >= 700 &&
        payout < 1000
      ) {
        shouldAccept = true;
        matchedMode = "mode_half_700_1000";
      }

      if (
        !shouldAccept &&
        modes.includes("mode_third_under_700") &&
        payout < 700
      ) {
        shouldAccept = true;
        matchedMode = "mode_third_under_700";
      }

      if (!shouldAccept && modes.includes("mode_3")) {
        shouldAccept = true;
        matchedMode = "mode_3";
      }

      if (!shouldAccept || !matchedMode) {
        console.log(
          `⏭ Пропущено по фильтру. Карта: ${account}, сумма: ${payout}`
        );
        return;
      }

      const token = localStorage.getItem("token");
      if (!token) return;

      fetch("https://my.prod.platcore.io/api/auction-deals/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dealId }),
      })
        .then(async (res) => {
          if (res.status === 201) {
            stats[matchedMode].accepted++;
            logStatistics();
            //           console.log(
            //             `%cПринимаем:
            // Карта: ${account}
            // Сумма: ${payout}`,
            //             "color: green; font-weight: bold;"
            //           );
            // console.log(
            //   `%cСтатус: ${res.status} (успешно)`,
            //   "color: green; font-weight: bold;"
            // );
          } else {
            stats[matchedMode].skipped++;
            logStatistics();
            let error;
            try {
              error = await res.json();
            } catch {
              error = await res.text();
            }
            //           console.log(
            //             `%cПринимаем:
            // Карта: ${account}
            // Сумма: ${payout}`,
            //             "color: red; font-weight: bold;"
            //           );
            console.log(`%cОшибка принятия: ${res.status}`, "color: orange;");
          }
        })
        .catch((err) => {
          stats[matchedMode].skipped++;
          logStatistics();
          // console.error("❌ Ошибка при принятии:", err);
        });
    } catch (err) {
      console.error("❌ Ошибка при обработке входящего:", err);
    }
  }

  SniffedWebSocket.prototype = RealWebSocket.prototype;
  window.WebSocket = SniffedWebSocket;

  console.log("🧲 WebSocket-сниффер активирован с автофильтрацией");
  const activeModes = JSON.parse(localStorage.getItem("sniffer_modes") || "[]");
  console.log(
    "⚙️ Активные режимы:",
    activeModes.map((m) => stats[m]?.label || m)
  );
})();

async function sendWithRetry(url, options, retries = 3, delay = 100) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 201) return res;
    if (res.status === 500) {
      const data = await res.json().catch(() => null);
      if (data?.error === "AUCTION_DEAL_ACCEPTANCE_NOT_AVAILABLE") {
        // занято — не повторяем
        return res;
      }
    } else {
      return res; // любая другая ошибка
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { status: 500, retryExhausted: true }; // все попытки неудачны
}
