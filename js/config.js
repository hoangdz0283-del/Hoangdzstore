const localHosts = ["localhost", "127.0.0.1"];
window.HOANGDZ_API_BASE_URL = localHosts.includes(window.location.hostname)
    ? "http://127.0.0.1:8787"
    : "https://hoangdz-store-api.hoangdz0283.workers.dev";
