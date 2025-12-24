// ১. অ্যাডমিন প্যানেলে লগইন করার পাসওয়ার্ড (প্রয়োজনে বদলে নিন)
const ADMIN_PASSWORD = "12345"; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ================================================================
    // সেকশন ১: অ্যাডমিন প্যানেল এবং API (লিংক সেভ/ডিলিট করার জন্য)
    // ================================================================
    
    // অ্যাডমিন পেজ শো করা
    if (url.pathname === '/admin') {
      return handleAdminPage(request);
    }

    // নতুন চ্যানেল সেভ করা
    if (url.pathname === '/api/add' && request.method === 'POST') {
      return handleAddChannel(request, env);
    }

    // চ্যানেল ডিলিট করা
    if (url.pathname === '/api/delete' && request.method === 'POST') {
      return handleDeleteChannel(request, env);
    }

    // সব চ্যানেলের লিস্ট দেখা
    if (url.pathname === '/api/list') {
      return handleListChannels(env);
    }

    // ================================================================
    // সেকশন ২: ভিডিও স্ট্রিমিং এবং প্রক্সি লজিক (Main Engine)
    // ================================================================
    
    // ফরম্যাট: https://worker-domain/play/[channel_name]/[file_path]
    if (url.pathname.startsWith('/play/')) {
      const parts = url.pathname.split('/'); 
      // parts[0]="", parts[1]="play", parts[2]="channelName", parts[3...]="path"
      
      const channelName = parts[2];
      const relativePath = parts.slice(3).join('/'); 

      // ১. ডাটাবেস (CHANNELS1) থেকে আসল লিংক খুঁজে বের করা
      const originalBaseUrl = await env.CHANNELS1.get(channelName);

      if (!originalBaseUrl) {
        return new Response("Channel not found in database.", { status: 404 });
      }

      // ২. টার্গেট URL তৈরি করা (স্মার্ট পাথ ক্যালকুলেশন)
      let targetUrl;
      try {
        // যদি ইউজার প্রথমবার হিট করে (কোনো পাথ নেই)
        if (!relativePath) {
            targetUrl = originalBaseUrl;
        } else {
            // যদি relativePath নিজেই একটি পূর্ণ লিংক হয় (যেমন M3U8 এর ভেতরে অন্য সার্ভারের লিংক থাকে)
            if (relativePath.startsWith('http')) {
                targetUrl = relativePath;
            } else {
                // রিলেটিভ পাথ জোড়া লাগানো
                const baseObj = new URL(originalBaseUrl);
                // বেস ফোল্ডার বের করা (যেমন: http://ip:port/path/)
                const basePath = baseObj.href.substring(0, baseObj.href.lastIndexOf('/') + 1);
                targetUrl = new URL(relativePath, basePath).href;
            }
        }
      } catch (e) {
        return new Response("URL Construction Error: " + e.message, { status: 500 });
      }

      // ৩. আসল সার্ভার থেকে ডাটা আনা (IP/Port ফিক্স সহ)
      try {
        const targetUrlObj = new URL(targetUrl);
        
        const response = await fetch(targetUrl, {
          method: request.method,
          headers: {
            // আইপি সার্ভারগুলো যেন বুঝতে না পারে এটি বট
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            // আইপি প্যানেলগুলোর জন্য এটি সবচেয়ে জরুরি
            'Host': targetUrlObj.host, 
            'Connection': 'keep-alive',
            // কিছু সার্ভার রেফারার চেক করে
            'Referer': targetUrlObj.origin 
          }
        });

        // ৪. যদি M3U8 ফাইল হয়, তবে লিংক হাইড করার জন্য রিরাইট করতে হবে
        const contentType = response.headers.get('Content-Type');
        if (targetUrl.includes('.m3u8') || (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL')))) {
          
          let m3u8Text = await response.text();
          
          // রিরাইট ফাংশন কল করা
          m3u8Text = rewriteM3u8(m3u8Text, url.origin, channelName);

          return new Response(m3u8Text, {
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            }
          });
        }

        // ৫. যদি ভিডিও ফাইল (.ts) হয়, সরাসরি পাঠিয়ে দেওয়া
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        return newResponse;

      } catch (e) {
        return new Response("Failed to fetch stream. Check if IP/Port is active. Error: " + e.message, { status: 502 });
      }
    }

    // হোমপেজ মেসেজ
    return new Response("Stream Proxy is Running. Go to /admin to manage channels.", { status: 200 });
  }
};

// ================= HELPER FUNCTIONS =================

// M3U8 ফাইলের ভেতরের লিংকগুলো প্রক্সির লিংকে পরিবর্তন করা
function rewriteM3u8(content, workerOrigin, channelName) {
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    line = line.trim();
    if (!line) return line; // খালি লাইন বাদ
    
    // যদি লাইনটি কমেন্ট (#) না হয়, তার মানে এটি একটি লিংক (TS বা অন্য m3u8)
    if (!line.startsWith('#')) {
      // আমরা ফাইলের নাম বা লিংকের আগে আমাদের ওয়ার্কারের পাথ বসিয়ে দিচ্ছি
      return `${workerOrigin}/play/${channelName}/${line}`;
    }
    return line;
  });
  return newLines.join('\n');
}


// ================= ADMIN PANEL UI & API =================

async function handleAdminPage(request) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Stream Admin Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', sans-serif; padding: 20px; max-width: 700px; margin: 0 auto; background: #f0f2f5; }
            .card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
            h2, h3 { color: #333; margin-top: 0; }
            input, button { padding: 12px; margin: 8px 0; width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #ccc; font-size: 16px; }
            button { background: #0070f3; color: white; border: none; cursor: pointer; font-weight: bold; transition: 0.3s; }
            button:hover { background: #0051a2; }
            .btn-delete { background: #ff4d4f; width: auto; padding: 8px 15px; font-size: 14px; margin-top: 5px;}
            .btn-delete:hover { background: #d9363e; }
            .item { border-bottom: 1px solid #eee; padding: 15px 0; }
            .item:last-child { border-bottom: none; }
            code { background: #e6f7ff; padding: 5px; display: block; margin-top: 5px; border: 1px solid #91d5ff; border-radius: 4px; color: #0050b3; word-break: break-all; }
            .hidden { display: none; }
            label { font-weight: bold; font-size: 14px; color: #555; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2 style="text-align:center;">📺 Stream Control Panel</h2>
            
            <div id="loginSection">
                <input type="password" id="pass" placeholder="Enter Admin Password">
                <button onclick="checkPass()">Login to Dashboard</button>
            </div>

            <div id="mainSection" class="hidden">
                <div style="background: #e6fffa; padding: 10px; border-radius: 5px; border: 1px solid #b5f5ec; margin-bottom: 15px;">
                    <strong>System Status:</strong> Proxy is Active <span style="color:green">●</span>
                </div>

                <h3>➕ Add New Channel</h3>
                <label>Channel Name (e.g., sports, pogo):</label>
                <input type="text" id="cName" placeholder="Enter name without spaces">
                
                <label>Original M3U8 URL:</label>
                <input type="text" id="cUrl" placeholder="http://ip:port/path/index.m3u8">
                
                <button onclick="addChannel()">Add Channel</button>

                <h3 style="margin-top:30px;">📋 Channel List</h3>
                <div id="list">Loading...</div>
            </div>
        </div>

        <script>
            const API_PASS = "${ADMIN_PASSWORD}"; 

            function checkPass() {
                if(document.getElementById('pass').value === API_PASS) {
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('mainSection').classList.remove('hidden');
                    loadChannels();
                } else { alert('Incorrect Password!'); }
            }

            async function addChannel() {
                const name = document.getElementById('cName').value.trim();
                const url = document.getElementById('cUrl').value.trim();
                if(!name || !url) return alert('Please fill all fields');
                
                const btn = document.querySelector('button[onclick="addChannel()"]');
                btn.innerText = 'Adding...';
                
                await fetch('/api/add', {
                    method: 'POST',
                    body: JSON.stringify({name, url})
                });
                
                document.getElementById('cName').value = '';
                document.getElementById('cUrl').value = '';
                btn.innerText = 'Add Channel';
                loadChannels();
            }

            async function deleteChannel(name) {
                if(!confirm('Are you sure you want to delete "' + name + '"?')) return;
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
                
                if(Object.keys(channels).length === 0) {
                    list.innerHTML = '<p style="color:#777; text-align:center;">No channels added yet.</p>';
                    return;
                }

                for (const [name, url] of Object.entries(channels)) {
                    const proxyLink = window.location.origin + '/play/' + name;
                    list.innerHTML += \`
                        <div class="item">
                            <div style="font-size:18px; font-weight:bold; color: #222;">\${name}</div>
                            <div style="font-size:12px; color: #666; margin-bottom:5px;">Original: \${url}</div>
                            
                            <strong>Proxy Link:</strong>
                            <code>\${proxyLink}</code>
                            
                            <button class="btn-delete" onclick="deleteChannel('\${name}')">Delete</button>
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

// ================= API HANDLERS (Database: CHANNELS1) =================

async function handleAddChannel(req, env) {
    const data = await req.json();
    // এখানে CHANNELS1 ব্যবহার করা হচ্ছে
    await env.CHANNELS1.put(data.name, data.data || data.url);
    return new Response("Added", {status: 200});
}

async function handleDeleteChannel(req, env) {
    const data = await req.json();
    // এখানে CHANNELS1 ব্যবহার করা হচ্ছে
    await env.CHANNELS1.delete(data.name);
    return new Response("Deleted", {status: 200});
}

async function handleListChannels(env) {
    // এখানে CHANNELS1 ব্যবহার করা হচ্ছে
    const list = await env.CHANNELS1.list();
    const channels = {};
    for(const key of list.keys) {
        channels[key.name] = await env.CHANNELS1.get(key.name);
    }
    return new Response(JSON.stringify(channels), {
        headers: { 'Content-Type': 'application/json' }
    });
}
