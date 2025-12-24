export default {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
  
      // আপনার অরিজিনাল লিংকের ফোল্ডার বা ডিরেক্টরি লিংক
      // আমরা ফাইলের নাম (filename) বাদ দিয়ে শুধু পাথটুকু রাখব
      const UPSTREAM_BASE = 'https://cdn1.skygo.mn/live/disk1/Lotus/HLSv3-FTA';
  
      // ওয়ার্কারের পাথের সাথে অরিজিনাল বেস লিংক জোড়া লাগানো
      // উদাহরণ: ইউজার যদি worker.dev/file.m3u8 চায়,
      // এটি হয়ে যাবে: UPSTREAM_BASE + /file.m3u8
      const targetUrl = UPSTREAM_BASE + url.pathname + url.search;
  
      // রিকোয়েস্ট তৈরি করা
      const newRequest = new Request(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://cdn1.skygo.mn/', // অরিজিনকে ভ্যালিড রেফারার দেখানো
          ...request.headers
        }
      });
  
      try {
        let response = await fetch(newRequest);
  
        // রেসপন্স কপি করে নতুন হেডার সেট করা (CORS এর জন্য)
        let newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        newResponse.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        newResponse.headers.set('Access-Control-Max-Age', '86400');
  
        return newResponse;
  
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
      }
    }
  };
