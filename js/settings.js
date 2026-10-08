// Settings store. baseURL + model in localStorage; apiKey in localStorage too
// (browsers don't have native Keychain; localStorage is acceptable for a PWA).

const KEY_BASEURL = 'ledgerly.baseURL';
const KEY_APIKEY = 'ledgerly.apiKey';
const KEY_MODEL = 'ledgerly.model';

export const Settings = {
  get baseURL() { return localStorage.getItem(KEY_BASEURL) || 'https://api.openai.com/v1'; },
  set baseURL(v) { localStorage.setItem(KEY_BASEURL, v); },

  get apiKey() { return localStorage.getItem(KEY_APIKEY) || ''; },
  set apiKey(v) { localStorage.setItem(KEY_APIKEY, v); },

  get model() { return localStorage.getItem(KEY_MODEL) || 'gpt-4o-mini'; },
  set model(v) { localStorage.setItem(KEY_MODEL, v); },

  get config() {
    return { baseURL: this.baseURL, apiKey: this.apiKey, model: this.model };
  },

  get isConfigured() {
    return !!this.apiKey.trim() && !!this.baseURL.trim() && !!this.model.trim();
  }
};
