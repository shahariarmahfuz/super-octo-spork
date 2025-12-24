// অ্যাডমিন প্যানেলে ঢোকার পাসওয়ার্ড (এটি পরিবর্তন করে নিন)
const ADMIN_PASSWORD = "mysecretpass"; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ================================================================
    // ১. অ্যাডমিন প্যানেল এবং API (লিংক অ্যাড/ডিলিট করার জন্য)
    // ================================================================
    
    // অ্যাডমিন পেজ শো করা
    if (url.pathname === '/admin') {
      return handleAdminPage(request);
    }

    // নতুন চ্যানেল সেভ করা (API)
    if (url.pathname === '/api/add' && request.method === 'POST') {
      return handleAddChannel(request, env);
    }

    // চ্যানেল ডিলিট করা (API)
    if (url.pathname === '/api/delete' && request.method === 'POST') {
      return handleDeleteChannel(request, env);
    }

    // সব চ্যানেলের লিস্ট দেখা (API)
    if (url.pathname === '/api/list') {
      return handleListChannels(env);
    }

    // ================================================================
    // ২. ভিডিও স্ট্রিমিং লজিক (The Proxy Engine)
    // ================================================================
    
    // ইউজার চালাবে: https://worker-domain/play/[channel_name]/[filename]
    if (url.pathname.startsWith('/play/')) {
      const parts = url.pathname.split('/');
      // parts[0] = "", parts[1] = "play", parts[2] = "channelName", parts[3...] = path
      const channelName = parts[2];
      const relativePath = parts.slice(3).join('/'); // বাকি অংশ (যেমন: index.m3u8 বা segment.ts)

      // ডাটাবেস থেকে আসল লিংক খুঁজে বের করা
      const originalBaseUrl = await env.CHANNELS.get(channelName);

      if (!originalBaseUrl) {
        return new Response("Channel not found in database.", { status: 404 });
      }

      // আসল টার্গেট ইউআরএল তৈরি করা
      // আমরা 'new URL' ব্যবহার করব যা অটোমেটিক '../' বা রিলেটিভ পাথ হ্যান্ডেল করে
      let targetUrl;
      try {
        // যদি relativePath খালি থাকে, তাহলে মেইন লিংক, নাহলে মেইন লিংকের ফোল্ডার + পাথ
        if (!relativePath) {
            targetUrl = originalBaseUrl;
        } else {
            // আসল লিংকের বেস ডিরেক্টরি বের করা
            const baseObj = new URL(originalBaseUrl);
            const basePath = baseObj.href.substring(0, baseObj.href.lastIndexOf('/') + 1);
            
            // রিলেটিভ পাথ যোগ করা (এটি অটোমেটিক ../ ক্যালকুলেট করবে)
            targetUrl = new URL(relativePath, basePath).href;
        }
      } catch (e) {
        return new Response("URL Error: " + e.message, { status: 500 });
      }

      // আসল সার্ভার থেকে ডাটা আনা
      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': new URL(targetUrl).origin
          }
        });

        // যদি M3U8 ফাইল হয়, তবে ভেতরের লিংকগুলো রিরাইট করতে হবে
        if (targetUrl.includes('.m3u8') || response.headers.get('Content-Type')?.includes('mpegurl')) {
          let m3u8Text = await response.text();
          
          // M3U8 রিরাইট ফাংশন কল করা
          m3u8Text = rewriteM3u8(m3u8Text, url.origin, channelName);

          return new Response(m3u8Text, {
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        // যদি TS বা ভিডিও ফাইল হয়, সরাসরি দিয়ে দেওয়া
        const newRes = new Response(response.body, response);
        newRes.headers.set('Access-Control-Allow-Origin', '*');
        return newRes;

      } catch (e) {
        return new Response("Stream Fetch Error: " + e.message, { status: 500 });
      }
    }

    return new Response("Welcome to Proxy Server. Go to /admin to manage.", { status: 200 });
  }
};

// ================= HELPER FUNCTIONS =================

// M3U8 ফাইলের ভেতরের লিংক পাল্টানোর ফাংশন
function rewriteM3u8(content, workerOrigin, channelName) {
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    line = line.trim();
    if (!line) return line;
    // যদি লাইনটি কমেন্ট (#) না হয়, তার মানে এটি একটি লিংক (TS বা অন্য m3u8)
    if (!line.startsWith('#')) {
      // লিংকটিকে আমাদের প্রক্সির ফরম্যাটে নিয়ে আসা
      // ফরম্যাট: https://worker/play/[channelName]/[original_line]
      return `${workerOrigin}/play/${channelName}/${line}`;
    }
    return line;
  });
  return newLines.join('\n');
}

// অ্যাডমিন পেজের HTML
async function handleAdminPage(request) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Stream Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
            input, button { padding: 10px; margin: 5px 0; width: 100%; box-sizing: border-box; }
            .item { border: 1px solid #ddd; padding: 10px; margin-top: 10px; border-radius: 5px; background: #f9f9f9;}
            code { background: #eee; padding: 2px 5px; word-break: break-all; }
            .hidden { display: none; }
        </style>
    </head>
    <body>
        <h2>Stream Manager</h2>
        
        <div id="loginSection">
            <input type="password" id="pass" placeholder="Enter Password">
            <button onclick="checkPass()">Login</button>
        </div>

        <div id="mainSection" class="hidden">
            <h3>Add New Channel</h3>
            <input type="text" id="cName" placeholder="Channel Name (e.g. duronto)">
            <input type="text" id="cUrl" placeholder="Original M3U8 URL">
            <button onclick="addChannel()">Add Channel</button>

            <h3>Active Channels</h3>
            <div id="list">Loading...</div>
        </div>

        <script>
            const API_PASS = "${ADMIN_PASSWORD}"; 

            function checkPass() {
                if(document.getElementById('pass').value === API_PASS) {
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('mainSection').classList.remove('hidden');
                    loadChannels();
                } else { alert('Wrong Password'); }
            }

            async function addChannel() {
                const name = document.getElementById('cName').value;
                const url = document.getElementById('cUrl').value;
                if(!name || !url) return alert('Fill all fields');
                
                await fetch('/api/add', {
                    method: 'POST',
                    body: JSON.stringify({name, url})
                });
                document.getElementById('cName').value = '';
                document.getElementById('cUrl').value = '';
                loadChannels();
            }

            async function deleteChannel(name) {
                if(!confirm('Delete ' + name + '?')) return;
                await fetch('/api/delete', {
                    method: 'POST',
                    body: JSON.stringify({name})
                });
                loadChannels();
            }

            async function loadChannels() {
                const res = await fetch('/api/list');
                const channels = await res.json();
                const list = document.getElementById('list');
                list.innerHTML = '';
                
                for (const [name, url] of Object.entries(channels)) {
                    const proxyLink = window.location.origin + '/play/' + name;
                    list.innerHTML += \`
                        <div class="item">
                            <strong>\${name}</strong><br>
                            <small>Original: \${url}</small><br>
                            <br>
                            <strong>Proxy Link (Give to User):</strong><br>
                            <code>\${proxyLink}</code>
                            <br><br>
                            <button onclick="deleteChannel('\${name}')" style="background:red; color:white; width:auto;">Delete</button>
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

// API হ্যান্ডলার ফাংশনস
async function handleAddChannel(req, env) {
    const data = await req.json();
    await env.CHANNELS.put(data.name, data.data || data.url);
    return new Response("Added");
}

async function handleDeleteChannel(req, env) {
    const data = await req.json();
    await env.CHANNELS.delete(data.name);
    return new Response("Deleted");
}

async function handleListChannels(env) {
    const list = await env.CHANNELS.list();
    const channels = {};
    for(const key of list.keys) {
        channels[key.name] = await env.CHANNELS.get(key.name);
    }
    return new Response(JSON.stringify(channels));
}
