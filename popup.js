const status = document.getElementById("status");
const toggleBtn = document.getElementById("toggleBtn");
const applyBtn = document.getElementById("applyBtn");
const checkboxes = document.querySelectorAll(".modeCheckbox");

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  const tabId = tab.id;

  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: () => ({
        enabled: localStorage.getItem("sniffer_enabled") !== "false",
        modes: JSON.parse(localStorage.getItem("sniffer_modes") || "[]"),
      }),
    },
    ([res]) => {
      const { enabled, modes } = res.result;

      updateToggleUI(enabled);
      updateCheckboxes(modes);

      toggleBtn.onclick = () => {
        const newEnabled = !enabled;
        updateToggleUI(newEnabled); // 🔄 Сразу меняем отображение

        chrome.scripting.executeScript({
          target: { tabId },
          func: (value) => {
            localStorage.setItem("sniffer_enabled", value ? "true" : "false");
            location.reload();
          },
          args: [newEnabled],
        });
      };

      applyBtn.onclick = () => {
        const selectedModes = Array.from(checkboxes)
          .filter((cb) => cb.checked)
          .map((cb) => cb.value);

        chrome.scripting.executeScript({
          target: { tabId },
          func: (modes) => {
            localStorage.setItem("sniffer_modes", JSON.stringify(modes));
            location.reload();
          },
          args: [selectedModes],
        });
      };
    }
  );
});

function updateToggleUI(enabled) {
  status.textContent = `Сниффер: ${enabled ? "🟢 ВКЛ" : "🔴 ВЫКЛ"}`;
  toggleBtn.textContent = enabled ? "Выключить" : "Включить";
  toggleBtn.className = enabled ? "off" : "";
}

function updateCheckboxes(modes) {
  checkboxes.forEach((cb) => {
    cb.checked = modes.includes(cb.value);
  });
}
