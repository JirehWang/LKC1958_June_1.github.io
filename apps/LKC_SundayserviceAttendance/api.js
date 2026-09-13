/**
 * api.js - GAS API 橋接層 (整合 Supabase 熱響應服務)
 */
if (typeof window.GAS_CONFIG === 'undefined') {
  console.error('❌ 找不到 config.js');
}

window.google = {
  script: {
    url: {
      getLocation: function(callback) {
        const params = {};
        new URLSearchParams(window.location.search).forEach((v, k) => { params[k] = v; });
        callback({ parameter: params });
      }
    },
    run: (function() {
      const READ_ONLY_ACTIONS = new Set([
        'getGroupConfig', 'getSmartAttendanceList', 'getQuickSyncData',
        'getAttendanceStats', 'getAttendanceTrend', 'getAgmSessions',
        'getAgmSessionById', 'getAgmCheckinState', 'getAgmCategoryCounts',
        'getAgmQuorumStats', 'getOfficialMembers', 'getViewerStats',
        'getMemberManagementData', 'getAllMembers'
      ]);
      const REQUEST_TIMEOUT_MS = 15000;
      const MAX_READ_ATTEMPTS = 3;

      function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }

      function request(apiUrl, body, retryable, attempt) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timeoutId = null;
        const options = {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body)
        };
        if (controller) {
          options.signal = controller.signal;
          timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        }
        return fetch(apiUrl, options)
          .then(async response => {
            const text = await response.text();
            if (!response.ok) throw new Error('GAS HTTP ' + response.status);
            let data;
            try {
              data = JSON.parse(text);
            } catch (error) {
              throw new Error('GAS 回應格式錯誤');
            }
            if (data && data.error) throw new Error(data.error);
            return data;
          })
          .catch(error => {
            const attempts = attempt || 1;
            if (retryable && attempts < MAX_READ_ATTEMPTS) {
              return wait(400 * attempts).then(() => request(apiUrl, body, true, attempts + 1));
            }
            throw error;
          })
          .finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
          });
      }

      // 建立一個帶有 successHandler / failureHandler 的呼叫鏈
      function makeRunner(successHandler, failureHandler) {
        const handler = {
          withSuccessHandler: function(fn) {
            return makeRunner(fn, failureHandler);
          },
          withFailureHandler: function(fn) {
            return makeRunner(successHandler, fn);
          }
        };

        // 用 Proxy 攔截所有函式名稱
        return new Proxy(handler, {
          get(target, functionName) {
            // 如果是 withSuccessHandler / withFailureHandler 就直接回傳
            if (functionName in target) return target[functionName];

            // 否則視為 API 函式名稱，回傳一個可以呼叫的函式
            return async function(...args) {
              const argPayload = args.length === 1 ? args[0] : args;

              // ⚡ 優先嘗試 Supabase 熱響應服務 (<50ms)
              if (window.AttendanceSupabaseService && typeof window.AttendanceSupabaseService[functionName] === 'function') {
                try {
                  const sbRes = await window.AttendanceSupabaseService[functionName](argPayload);
                  if (successHandler) {
                    successHandler(sbRes);
                  }
                  return;
                } catch (sbErr) {
                  console.warn(`[Supabase Service] ${functionName} 執行失敗，切換至 GAS:`, sbErr.message);
                }
              }

              const apiUrl = window.GAS_CONFIG && window.GAS_CONFIG.apiUrl;
              if (!apiUrl || apiUrl.includes('YOUR_SCRIPT_ID')) {
                const err = new Error('❌ 請先設定 config.js 中的 GAS Web App URL！');
                console.error(err.message);
                if (failureHandler) failureHandler(err);
                return;
              }

              const body = {
                action: functionName,
                payload: argPayload
              };
              request(apiUrl, body, READ_ONLY_ACTIONS.has(String(functionName)), 1)
                .then(data => {
                  if (successHandler) successHandler(data && data.data);
                })
                .catch(err => {
                  if (failureHandler) failureHandler(err);
                });
            };
          }
        });
      }

      // run 本身就是一個 makeRunner 的起點
      return makeRunner(null, (err) => console.error('GAS Error:', err));
    })()
  }
};
