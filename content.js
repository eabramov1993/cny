(() => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("sniffer.js");
    (document.head || document.documentElement).appendChild(script);
  })();