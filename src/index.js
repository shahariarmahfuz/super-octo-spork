export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ১. আপনার আসল M3U8 লিংক
    const ORIGINAL_M3U8_URL = 'https://cdn1.skygo.mn/live/disk1/Lotus/HLSv3-FTA/Lotus-avc1_2089200=342-mp4a_256000_eng=343.m3u8';

    // ২. TS ফাইলগুলোর বেস ফোল্ডার (M3U8 লিংকের ২ ধাপ উপরে)
    // কারণ আপনার M3U8 ফাইলে "../" ব্যবহার করা হয়েছে, তাই এটি "Lotus" ফোল্ডারে আছে।
    const TS_BASE_URL = 'https://cdn1.skygo.mn/live/disk1/Lotus';

    // ৩. কমন হেডার (ব্রাউজারের মতো সাজার জন্য)
    const commonHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://cdn1.skygo.mn/',
      'Origin': 'https://cdn1.skygo.mn'
    };

    // ================================================================
    // লজিক ১: যদি ইউজার মেইন M3U8 ফাইল চায় (যেমন: worker.dev/video.m3u8)
    // ================================================================
    if (url.pathname === '/' || url.pathname.endsWith('.m3u8')) {
      try {
        const response = await fetch(ORIGINAL_M3U8_URL, { headers: commonHeaders });
        let m3u8Text = await response.text();

        // সমস্যা সমাধান: "../" রিমুভ করে দেওয়া যাতে ওয়ার্কার ঠিকমতো পাথ পায়
        // "../_shared..." কে আমরা "/_shared..." বানিয়ে দিচ্ছি
        m3u8Text = m3u8Text.replaceAll('../', '/');

        return new Response(m3u8Text, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          }
        });
      } catch (e) {
        return new Response("Error fetching M3U8: " + e.message, { status: 500 });
      }
    }

    // ================================================================
    // লজিক ২: যদি ইউজার TS ফাইল চায় (যা "_shared" ফোল্ডারে আছে)
    // ================================================================
    // প্লেয়ার যখন "/_shared_..." রিকোয়েস্ট করবে, তখন আমরা এটি হ্যান্ডেল করব
    if (url.pathname.includes('_shared')) {
      // আসল লিংক তৈরি করা: TS_BASE_URL + incoming path
      // উদাহরণ: https://cdn1.skygo.mn/live/disk1/Lotus + /_shared_...
      const targetUrl = TS_BASE_URL + url.pathname;

      try {
        const response = await fetch(targetUrl, { headers: commonHeaders });
        
        // ভিডিও ফাইল স্ট্রিম করা
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        
        return newResponse;
      } catch (e) {
        return new Response("Error fetching TS: " + e.message, { status: 500 });
      }
    }

    // যদি অন্য কিছু রিকোয়েস্ট আসে
    return new Response("Path not found", { status: 404 });
  }
};
