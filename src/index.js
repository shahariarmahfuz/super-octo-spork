// ১. অ্যাডমিন প্যানেল পাসওয়ার্ড (প্রয়োজনে বদলে নিন)
const ADMIN_PASSWORD = "123456";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ================================================================
    // লজিক ১: M3U প্লেলিস্ট জেনারেটর (ইউজার এই লিংকটি ব্যবহার করবে)
    // লিংক: https://your-worker.dev/playlist.m3u
    // ================================================================
    if (url.pathname === '/playlist.m3u') {
      return handlePlaylistGenerator(env, url.origin);
    }

    // ================================================================
    // লজিক ২: প্লেয়ার রিডাইরেক্ট সিস্টেম (Play System)
    // ================================================================
    if (url.pathname.startsWith('/play/')) {
      const channelId = url.pathname.split('/')[2]; // ID বের করা

      // ডাটাবেস থেকে তথ্য আনা
      const dataStr = await env.CHANNELS1.get(channelId);

      if (!dataStr) {
        return new Response("Channel not found or deleted.", { status: 404 });
      }

      const data = JSON.parse(dataStr);
      
      // আসল লিংকে রিডাইরেক্ট করা (302 Found)
      // এটি ইউজারকে আসল সার্ভারে পাঠিয়ে দেবে, তাই আপনার ব্যান্ডউইথ খরচ হবে না
      return Response.redirect(data.url, 302);
    }

    // ================================================================
    // লজিক ৩: অ্যাডমিন প্যানেল এবং API
    // ================================================================
    if (url.pathname === '/admin') return handleAdminPage();
    if (url.pathname === '/api/add' && request.method === 'POST') return handleAddChannel(request, env);
    if (url.pathname === '/api/delete' && request.method === 'POST') return handleDeleteChannel(request, env);
    if (url.pathname === '/api/list') return handleListChannels(env);

    // হোমপেজ
    return new Response(`Your Playlist URL: ${url.origin}/playlist.m3u\n\nGo to /admin to manage channels.`, { status: 200 });
  }
};

// ------------------------------------------------------------------
// হেল্পার ফাংশন: প্লেলিস্ট তৈরি করা
// ------------------------------------------------------------------
async function handlePlaylistGenerator(env, origin) {
  const list = await env.CHANNELS1.list();
  
  // M3U হেডলাইন
  let m3uContent = '#EXTM3U\n';

  for (const key of list.keys) {
    const dataStr = await env.CHANNELS1.get(key.name);
    if (dataStr) {
      const data = JSON.parse(dataStr);
      
      // M3U ফরম্যাট তৈরি করা
      // #EXTINF:-1 tvg-id="name" tvg-logo="url" group-title="group",Title
      m3uContent += `#EXTINF:-1 tvg-id="${data.title}" tvg-name="${data.title}" tvg-logo="${data.logo}" group-title="${data.group}",${data.title}\n`;
      
      // আমাদের রিডাইরেক্ট লিংক বসানো
      m3uContent += `${origin}/play/${key.name}\n`;
    }
  }

  return new Response(m3uContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*', // যেকোনো প্লেয়ারে চলার জন্য
      'Cache-Control': 'no-cache' // লাইভ আপডেট পাওয়ার জন্য
    }
  });
}

// ------------------------------------------------------------------
// হেল্পার ফাংশন: অ্যাডমিন প্যানেল HTML
// ------------------------------------------------------------------
async function handleAdminPage() {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>IPTV Manager</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f0f2f5; }
      .card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      h2, h3 { text-align: center; color: #333; margin-top:0; }
      input, select, button { width: 100%; padding: 12px; margin: 8px 0; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box; }
      button { background: #0070f3; color: white; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
      button:hover { background: #0051a2; }
      .row { display: flex; gap: 10px; }
      .item { background: #fff; border: 1px solid #ddd; padding: 10px; margin-top: 10px; border-radius: 5px; display: flex; align-items: center; justify-content: space-between; }
      .item img { height: 40px; width: 40px; object-fit: contain; margin-right: 15px; border-radius: 4px; border: 1px solid #eee; }
      .hidden { display: none; }
      .link-box { background: #e6f7ff; padding: 15px; border: 1px solid #91d5ff; border-radius: 5px; margin-bottom: 20px; text-align: center; }
      .link-box a { color: #0050b3; font-weight: bold; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>📡 Playlist Controller</h2>

      <div id="loginSection">
        <input type="password" id="pass" placeholder="Enter Admin Password">
        <button onclick="login()">Login</button>
      </div>

      <div id="mainSection" class="hidden">
        
        <div class="link-box">
          <span>Your M3U Playlist URL:</span><br>
          <a href="#" target="_blank" id="playLink">Loading...</a>
        </div>

        <h3>Add New Channel</h3>
        
        <div class="row">
          <input type="text" id="cTitle" placeholder="Channel Name (e.g. T Sports)">
          <input type="text" id="cGroup" placeholder="Category (e.g. Sports)">
        </div>
        
        <input type="text" id="cLogo" placeholder="Logo URL (Optional)">
        <input type="text" id="cUrl" placeholder="Stream URL (http://ip:port/token...)">
        
        <button onclick="addChannel()">Add to Playlist</button>

        <h3 style="margin-top:30px; border-top:1px solid #eee; padding-top:20px;">Manage Channels</h3>
        <div id="list">Loading...</div>
      </div>
    </div>

    <script>
      const API_PASS = "${ADMIN_PASSWORD}";
      
      function login() {
        if(document.getElementById('pass').value === API_PASS) {
          document.getElementById('loginSection').classList.add('hidden');
          document.getElementById('mainSection').classList.remove('hidden');
          const plUrl = window.location.origin + '/playlist.m3u';
          document.getElementById('playLink').href = plUrl;
          document.getElementById('playLink').innerText = plUrl;
          loadChannels();
        } else { alert('Incorrect Password'); }
      }

      async function addChannel() {
        const title = document.getElementById('cTitle').value.trim();
        const group = document.getElementById('cGroup').value.trim() || 'General';
        const logo = document.getElementById('cLogo').value.trim() || 'https://via.placeholder.com/50';
        const url = document.getElementById('cUrl').value.trim();

        if(!title || !url) return alert('Name and URL are required!');

        // একটি ইউনিক ID তৈরি করা (নাম থেকে স্পেস সরিয়ে)
        const id = title.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const data = { name: id, title, group, logo, url };
        
        // বাটন লোডিং ইফেক্ট
        const btn = document.querySelector('button[onclick="addChannel()"]');
        const originalText = btn.innerText;
        btn.innerText = 'Saving...';

        await fetch('/api/add', { method: 'POST', body: JSON.stringify(data) });
        
        // ইনপুট ক্লিয়ার
        document.getElementById('cTitle').value = '';
        document.getElementById('cUrl').value = '';
        btn.innerText = originalText;
        loadChannels();
      }

      async function deleteChannel(id) {
        if(!confirm('Delete this channel?')) return;
        await fetch('/api/delete', { method: 'POST', body: JSON.stringify({name: id}) });
        loadChannels();
      }

      async function loadChannels() {
        const res = await fetch('/api/list');
        const list = await res.json();
        const container = document.getElementById('list');
        container.innerHTML = '';

        if(Object.keys(list).length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#888;">No channels found.</p>';
            return;
        }

        for (const key in list) {
          const item = JSON.parse(list[key]);
          container.innerHTML += \`
            <div class="item">
              <div style="display:flex; align-items:center;">
                <img src="\${item.logo}" onerror="this.src='https://via.placeholder.com/40'">
                <div>
                  <div style="font-weight:bold; font-size:16px;">\${item.title}</div>
                  <div style="font-size:12px; color:#666;">Group: \${item.group}</div>
                </div>
              </div>
              <button onclick="deleteChannel('\${item.name}')" style="width:auto; background:#ff4d4f; padding:8px 15px; margin:0;">Delete</button>
            </div>
          \`;
        }
      }
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ------------------------------------------------------------------
// API হ্যান্ডলারস (KV ডাটাবেস এর সাথে কথা বলার জন্য)
// ------------------------------------------------------------------

async function handleAddChannel(req, env) {
  const data = await req.json();
  // ডাটাবেসে JSON স্ট্রিং হিসেবে সেভ করা
  await env.CHANNELS1.put(data.name, JSON.stringify(data));
  return new Response("OK");
}

async function handleDeleteChannel(req, env) {
  const data = await req.json();
  await env.CHANNELS1.delete(data.name);
  return new Response("OK");
}

async function handleListChannels(env) {
  const list = await env.CHANNELS1.list();
  const channels = {};
  for(const key of list.keys) {
    channels[key.name] = await env.CHANNELS1.get(key.name);
  }
  return new Response(JSON.stringify(channels));
}
