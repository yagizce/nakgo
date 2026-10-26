/**
 * Eski host bağlantısı
 * Mevcut ortak veri bağdaştırıcısı; normal PWA yayını yerel demo olarak çalışır.
 */
// ===== Bulut katmanı =====
// Ortak veritabanı: yazma yardımcıları, okunan verinin duruma çevrilmesi, olay izleme, bulut başlatma.

const dbw = p => p.then(() => true).catch(() => { toast("Kayıt eşitlenemedi. Bağlantını ve erişimini kontrol edip tekrar dene."); return false; });

function rebuild() {
    if (!cloud) return;
    const previous = [...offers, ...incoming];
    offers = [];
    incoming = [];
    allO.forEach(od => {
        const L = loads.find(x => x.id === od.loadId) || normalizeListing(od.listing) || previous.find(x => x.loadId === od.loadId) || {id:od.loadId,from:"İlan kaldırıldı",to:"Güzergâh kaydı yok",cargo:"",uid:od.ownerUid||""};
        const B = String(od.bidder);
        const o = { ...L, offer: +od.offer || 0, status: ["wait", "ok", "counter", "no"].includes(od.status) ? od.status : "wait", counter: +od.counter || 0, loadId: L.id, bidder: B, ownerUid: od.ownerUid || "", stage: Math.min(3, Math.max(0, +od.stage || 0)), ots: +od.ts || 0, doneAt: +od.doneAt || 0 };
        if (B === me)
            offers.push(o);
        else if (L.uid && L.uid === me && !blocked.includes(B))
            incoming.push(o);
    });
}

function track(t, id) {
    if (!cloud)
        return;
    const l = loads.find(x => x.id === id);
    if (!l || !l.uid || l.uid === me)
        return;
    const k = t + "_" + id;
    if (tracked.has(k))
        return;
    tracked.add(k);
    db.doc("events/" + k + "_" + me).set({ t, loadId: id, uid: me, ts: Date.now() }).catch(() => { });
}

function untrack(t, id) {
    if (!cloud)
        return;
    const k = t + "_" + id;
    tracked.delete(k);
    db.doc("events/" + k + "_" + me).delete().catch(() => { });
}

// Ortak kayıttan gelen değişiklikleri önbelleğe al; tercihleri geri gönderme.
function refreshCloudState() {
    save(false);
    soft();
}

async function initCloud() {
    try {
        if (!window.claude || !claude.use)
            return;
        const [d, u] = await Promise.all([claude.use("db"), claude.use("user")]);
        if (!d || !u)
            return;
        me = await u.id();
        if (!me)
            return;
        db = d;
        cloud = true;
        loaded = false;
        myName = String((await u.me()).name || "");
        names[me] = myName || "Ben";
        const ts = (a, b) => (b.ts || 0) - (a.ts || 0) || String(a.id).localeCompare(String(b.id), "tr", { numeric: true });
        const who = async (list) => {
            const ids = [...new Set(list.filter(Boolean))].filter(i => !names[i]);
            if (!ids.length)
                return;
            const pr = await u.profiles(ids);
            ids.forEach(i => names[i] = String((pr[i] && pr[i].name) || "") || "Kullanıcı");
            soft();
        };
        const sim = new Set();
        db.collection("loads").onSnapshot(sn => {
            loads = sn.docs.map(x => normalizeListing(x.data())).filter(Boolean).sort(ts);
            who(loads.map(l => l.uid));
            rebuild();
            loaded = true;
            refreshCloudState();
            deep();
        }, () => {
            loaded = true;
            soft();
        });
        db.collection("trucks").onSnapshot(sn => {
            trucks = sn.docs.map(x => normalizeListing(x.data())).filter(Boolean).sort(ts);
            who(trucks.map(t => t.uid));
            refreshCloudState();
        }, () => { });
        db.collection("offers").onSnapshot(sn => {
            allO = sn.docs.map(x => x.data());
            rebuild();
            offers.filter(o => o.status === "wait" && !o.ownerUid && !sim.has(o.id)).forEach(o => {
                sim.add(o.id);
                simulate(o.id);
            });
            refreshCloudState();
        }, () => { });
        let first = true;
        db.collection("carriers").onSnapshot(sn => {
            carriers = {};
            sn.docs.forEach(x => {
                const v = x.data();
                carriers[x.id] = { displayName: String(v.displayName || "").slice(0,60), city: String(v.city || "").slice(0,40), about: String(v.about || "").slice(0,200), phone: String(v.phone || "").slice(0, 20), ok: v.ok === true, lic: String(v.lic || ""), src: !!v.src, kb: !!v.kb, ruh: !!v.ruh, docs: { src: !!(v.docs && v.docs.src), kb: !!(v.docs && v.docs.kb), ruh: !!(v.docs && v.docs.ruh) } };
            });
            if (first) {
                if (carriers[me])
                    myCar = { ...carriers[me] };
                first = false;
            }
            who(Object.keys(carriers));
            refreshCloudState();
        }, () => { });
        admin = await u.isOwner();
        db.collection("events").onSnapshot(sn => {
            events = sn.docs.map(x => {
                const v = x.data();
                return { t: String(v.t || ""), loadId: +v.loadId || 0, uid: String(v.uid || ""), ts: +v.ts || 0 };
            });
            soft();
        }, () => { });
        if (admin)
            db.collection("reports").onSnapshot(sn => {
                reports = sn.docs.map(x => ({ k: x.id, ...clean(x.data()) }));
                refreshCloudState();
            }, () => { });
        db.collection("ratings").onSnapshot(sn => {
            rates = sn.docs.map(x => {
                const v = x.data();
                return { k: x.id, to: String(v.to || ""), by: String(v.by || ""), stars: Math.min(5, Math.max(1, +v.stars || 1)), text: String(v.text || ""), ts: +v.ts || 0 };
            });
            refreshCloudState();
        }, () => { });
        db.collection("approvals").onSnapshot(sn => {
            appr = {};
            sn.docs.forEach(x => {
                appr[x.id] = x.data().ok === true;
            });
            soft();
        }, () => { });
        try {
            const pd = await db.doc("premium/" + me).get();
            if (pd.exists) {
                const v = pd.data();
                prem = { until: +v.until || 0, plan: String(v.plan || "") };
            }
        }
        catch (e) { }
        const ps = await db.doc("data/users/" + me + "/prefs").get();
        if (ps.exists) {
            const v = ps.data();
            favs = Array.isArray(v.favs) ? v.favs.map(String) : [];
            if (v.calc)
                calc = { ...calc, ...v.calc };
            alerts = Array.isArray(v.alerts) ? v.alerts.slice(0, 20) : [];
            blocked = Array.isArray(v.blocked) ? v.blocked.map(String).slice(0, 200) : [];
        }
        lastP = JSON.stringify({ favs, calc, alerts, blocked });
        refreshCloudState();
    }
    catch (e) { }
}

// Supabase Auth is deliberately independent of the legacy host and demo records.
// The pinned official browser SDK owns PKCE, session refresh and sign-out.
const nakgoAuth = (() => {
    let client = null, revision = 0, started = false;
    const state = {enabled:false, ready:false, user:null, profile:null, recovery:false, error:''};
    const snapshot = () => ({...state, user:state.user ? {...state.user} : null, profile:state.profile ? {...state.profile} : null});
    const changed = () => { if (typeof nakgoMarket !== 'undefined') nakgoMarket.sync(snapshot()); if (tab === 'me' || tab === 'mine') render(); };
    const message = error => ({
        invalid_credentials:'E-posta veya şifre doğru değil.',
        email_not_confirmed:'Giriş yapmadan önce e-postandaki doğrulama bağlantısını aç.',
        over_email_send_rate_limit:'E-posta sınırına ulaşıldı. Bir süre sonra tekrar dene.',
        over_request_rate_limit:'Çok sık deneme yapıldı. Bir süre sonra tekrar dene.',
        email_address_not_authorized:'Test ortamı şu an yalnız proje ekibinin e-posta adreslerine gönderim yapabiliyor.',
        weak_password:'Daha güçlü bir şifre seç.',
        same_password:'Önceki şifrenden farklı bir şifre seç.',
        otp_expired:'Bağlantının süresi dolmuş veya daha önce kullanılmış. Yeni bağlantı iste.',
        flow_state_not_found:'Bağlantıyı isteği başlattığın tarayıcıda aç veya yeni bağlantı iste.',
        bad_code_verifier:'Bu bağlantı tarayıcıdaki sıfırlama isteğiyle eşleşmiyor. Buradan yeni bağlantı iste ve en son gelen e-postayı kullan.'
    }[error?.code] || 'İşlem tamamlanamadı. Bağlantını kontrol edip tekrar dene.');
    const configOK = c => c?.enabled === true && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(c.url) && /^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(c.publishableKey);
    const requireClient = () => { if (!client || !state.ready) throw Error('Auth unavailable'); return client; };
    const redirectTo = () => new URL('/', location.origin).href;

    async function sync() {
        const current = ++revision;
        const {data:{session}, error:sessionError} = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (current !== revision) return;
        if (!session) { state.user=null; state.profile=null; state.recovery=false; changed(); return; }
        // Never use the locally cached user as proof of a valid identity.
        const {data, error} = await client.auth.getUser();
        if (error) { if(current===revision) {state.user=null;state.profile=null;} throw error; }
        if (current !== revision) return;
        const user = data.user;
        state.user = {id:user.id, email:user.email || ''};
        state.profile = null; changed();
        // Password recovery needs a verified identity, not a successful profile query.
        if (state.recovery) { state.error=''; changed(); return; }
        let result = await client.from('profiles').select('id,display_name,account_type,city,about,phone').eq('id',user.id).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) {
            const metadata = user.user_metadata || {};
            const profile = {id:user.id, display_name:String(metadata.display_name || metadata.full_name || '').trim().slice(0,60), account_type:['carrier','owner'].includes(metadata.account_type) ? metadata.account_type : null};
            result = await client.from('profiles').insert(profile).select('id,display_name,account_type,city,about,phone').single();
            if (result.error?.code === '23505') result = await client.from('profiles').select('id,display_name,account_type,city,about,phone').eq('id',user.id).single();
            if (result.error) throw result.error;
        }
        if (current !== revision) return;
        state.profile = result.data;
        state.error = '';
        changed();
    }

    function loadSDK() {
        return new Promise((resolve,reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
            script.integrity = 'sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R';
            script.crossOrigin = 'anonymous'; script.referrerPolicy = 'no-referrer'; script.async = true;
            const timer = setTimeout(() => { script.remove(); reject(Error('SDK timeout')); },15000);
            script.onload = () => { clearTimeout(timer); window.supabase?.createClient ? resolve() : reject(Error('SDK unavailable')); };
            script.onerror = () => { clearTimeout(timer); script.remove(); reject(Error('SDK unavailable')); };
            document.head.appendChild(script);
        });
    }

    async function init() {
        if (started || typeof window === 'undefined' || !window.fetch) return;
        started = true;
        // Capture the callback before the SDK consumes its code and changes the URL.
        const address = new URL(location.href);
        const fragment=new URL('/?'+address.hash.slice(1),location.origin).searchParams;
        let recoveryReturn=address.searchParams.get('auth')==='recovery';
        try {
            const requested=Number(localStorage.getItem('ng-recovery-request'));
            if ((address.searchParams.has('code')||fragment.has('sb')||fragment.has('error')) && requested>0 && Date.now()-requested<3600000) recoveryReturn=true;
        } catch(e) { }
        const callbackError=address.searchParams.has('error') || address.searchParams.has('error_code') || fragment.has('error') || fragment.has('error_code');
        const showReturn = () => {
            tab='me'; setNav(); changed();
            const onb=$('#onb'); if(onb)onb.style.display='none';
            if(state.ready) {
                openAuth(state.recovery&&state.user?'password':'recover');
                const feedback=$('#account-feedback'); if(feedback)feedback.textContent=state.error;
            }
        };
        try {
            const response = await window.fetch('/api/auth/config', {cache:'no-store', signal:AbortSignal.timeout(8000)});
            if (!response.ok) return;
            const config = await response.json();
            if (!configOK(config)) return;
            state.enabled = true; state.marketplace = config.marketplaceEnabled === true; changed();
            await loadSDK();
            client = window.supabase.createClient(config.url,config.publishableKey, {auth:{
                flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true,
                experimental:{appendPkceFlowIdToRedirects:true},
                storageKey:'ng-auth-'+new URL(config.url).hostname.split('.')[0]
            }});
            client.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_OUT') {
                    revision++; state.user=null; state.profile=null; state.recovery=false; state.error=''; changed();
                }
                if (event === 'PASSWORD_RECOVERY') state.recovery = true;
                // SDK callbacks must not await another SDK auth operation (lock deadlock).
                if (['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED','PASSWORD_RECOVERY'].includes(event)) setTimeout(() => {
                    sync().then(() => {
                        if (event === 'PASSWORD_RECOVERY' && state.recovery && state.user) { const onb=$('#onb'); if(onb)onb.style.display='none'; openAuth('password'); }
                    }).catch(error => { state.error=message(error); changed(); if(event==='PASSWORD_RECOVERY')showReturn(); });
                },0);
            });
            state.ready = true;
            let googleReturn=false;
            try {googleReturn=sessionStorage.getItem('ng-google-return')==='1';sessionStorage.removeItem('ng-google-return');} catch(e) { }
            if(googleReturn) {tab='me';setNav();}
            if (callbackError) {
                for (const k of ['error','error_code','error_description','code']) address.searchParams.delete(k);
                if(fragment.has('error') || fragment.has('error_code')) {
                    for(const k of ['error','error_code','error_description','code'])fragment.delete(k);
                    address.hash=fragment.toString();
                }
                history.replaceState(history.state,'',address.pathname+address.search+address.hash);
            }
            await sync();
            if(callbackError)state.error=googleReturn ? 'Google ile giriş tamamlanmadı. Yeniden deneyebilirsin.' : 'Doğrulama bağlantısı kullanılamadı. Aynı tarayıcıdan yeni bağlantı iste.';
            changed();
            if(state.recovery&&state.user)showReturn();
            else if(recoveryReturn || (callbackError&&!googleReturn)) {
                if(!state.error)state.error='Sıfırlama oturumu doğrulanamadı. En son e-postadaki bağlantıyı kullan veya buradan yeni bağlantı iste.';
                showReturn();
            } else if(callbackError) {tab='me';setNav();changed();}
        } catch(error) { if(state.enabled) {state.error=message(error); changed(); if(recoveryReturn||callbackError)showReturn();} }
    }

    async function signIn(email,password) {
        const {error} = await requireClient().auth.signInWithPassword({email,password});
        if(error)throw error;
        await sync();
    }
    async function signInGoogle() {
        const auth=requireClient().auth;
        try {
            // This marker restores the account screen only; it never proves identity.
            try {sessionStorage.setItem('ng-google-return','1');} catch(e) { }
            const {error}=await auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo()}});
            if(error)throw error;
        } catch(error) {
            try {sessionStorage.removeItem('ng-google-return');} catch(e) { }
            throw error;
        }
    }
    async function signUp(email,password,displayName,accountType) {
        const {data,error} = await requireClient().auth.signUp({email,password,options:{
            emailRedirectTo:redirectTo(),data:{display_name:displayName.trim().slice(0,60),account_type:accountType}
        }});
        if(error)throw error;
        if(data.session)await sync();
        return !!data.session;
    }
    async function recover(email) {
        // Navigation hint only. Only the SDK recovery event can authorize a password change.
        try {localStorage.setItem('ng-recovery-request',String(Date.now()));} catch(e) { }
        const {error} = await requireClient().auth.resetPasswordForEmail(email,{redirectTo:redirectTo()});
        if(error)throw error;
    }
    async function password(value) {
        if(!state.recovery || !state.user)throw Error('Recovery session required');
        const {error} = await requireClient().auth.updateUser({password:value});
        if(error)throw error;
        // Keep the recovery gate until sign-out succeeds; do not leave a reset session active.
        await signOut();
    }
    async function signOut() {
        const {error} = await requireClient().auth.signOut({scope:'local'});
        if(error)throw error;
        revision++; state.user=null; state.profile=null; state.recovery=false; state.error=''; changed();
    }
    async function saveProfile(displayName,accountType) {
        if(!state.user)throw Error('Sign in required');
        const {error} = await requireClient().from('profiles').update({display_name:displayName.trim().slice(0,60),account_type:accountType}).eq('id',state.user.id);
        if(error)throw error;
        await sync();
    }
    async function saveProfileDetails(patch) {
        if(!state.user || !state.profile || state.recovery)throw Error('Profile unavailable');
        const id=state.user.id, current=revision, values={};
        for(const [key,max] of [['display_name',60],['city',40],['about',200],['phone',11]]) {
            if(!Object.prototype.hasOwnProperty.call(patch,key))continue;
            if(typeof patch[key]!=='string' || patch[key].trim().length>max)throw Error('Invalid profile');
            values[key]=patch[key].trim();
        }
        if(!Object.keys(values).length || (values.phone && !/^05[0-9]{9}$/.test(values.phone)))throw Error('Invalid profile');
        const result=await requireClient().from('profiles').update(values).eq('id',id).select('id,display_name,account_type,city,about,phone').single();
        if(result.error)throw result.error;
        if(current!==revision || state.user?.id!==id)throw Error('Account changed');
        state.profile=result.data; state.error=''; changed();
    }
    const listingColumns='id,owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,available_time,items,image_data,status,created_at,updated_at';
    const listingFields=['from_city','to_city','vehicle','body','amount','cargo','note','available_on','available_until','available_time','items','image_data'];
    function listingAccount() {
        if(!state.user || !state.profile || state.recovery)throw Error('Sign in required');
        return {id:state.user.id, revision};
    }
    function listingResult(result,account) {
        if(result.error)throw result.error;
        if(account.revision!==revision || state.user?.id!==account.id)throw Error('Account changed');
        return result.data;
    }
    async function listListings({own=false,before=null}={}) {
        const account=listingAccount();
        let query=requireClient().from('listings').select(listingColumns).order('id',{ascending:false}).limit(50);
        if(own)query=query.eq('owner_id',account.id);
        else query=query.eq('status','active');
        if(before!==null) {
            if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid cursor');
            query=query.lt('id',before);
        }
        return listingResult(await query,account);
    }
    async function createListing(input) {
        const account=listingAccount();
        if(!['load','truck'].includes(input?.kind))throw Error('Invalid kind');
        const values={kind:input.kind,owner_label:String(state.profile.display_name||'NakGo kullanıcısı').trim().slice(0,60)};
        for(const key of listingFields)if(Object.prototype.hasOwnProperty.call(input,key))values[key]=input[key];
        return listingResult(await requireClient().from('listings').insert(values).select(listingColumns).single(),account);
    }
    async function updateListing(id,input) {
        const account=listingAccount();
        if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid listing');
        const values={};
        for(const key of [...listingFields,'status'])if(Object.prototype.hasOwnProperty.call(input,key))values[key]=input[key];
        if(!Object.keys(values).length)throw Error('No editable fields');
        return listingResult(await requireClient().from('listings').update(values).eq('id',id).eq('owner_id',account.id).select(listingColumns).single(),account);
    }
    const jobColumns='id,listing_id,owner_id,carrier_id,carrier_label,listing_snapshot,status,stage,created_at,updated_at,expires_at,loaded_at,confirmed_at';
    async function listJobs(before=null) {
        const account=listingAccount();
        let q=requireClient().from('transport_jobs').select(jobColumns).order('id',{ascending:false}).limit(50);
        if(before!==null){if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid cursor');q=q.lt('id',before);}
        return listingResult(await q,account);
    }
    async function listFavorites({before=null,details=false}={}) {
        const account=listingAccount();
        let q=requireClient().from('listing_favorites').select(details?'listing_id,listing:listings('+listingColumns+')':'listing_id')
            .order('listing_id',{ascending:false}).limit(details?50:200);
        if(before!==null){if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid cursor');q=q.lt('listing_id',before);}
        return listingResult(await q,account);
    }
    async function setFavorite(id,saved) {
        const account=listingAccount();
        if(!Number.isSafeInteger(id)||id<1||typeof saved!=='boolean')throw Error('Invalid favorite');
        return listingResult(await requireClient().rpc('nakgo_set_favorite',{p_listing_id:id,p_saved:saved}),account);
    }
    async function jobCounts() {
        const account=listingAccount();
        const count=async(done)=>{
            let q=requireClient().from('transport_jobs').select('id',{count:'exact',head:true}).eq('status','ok');
            q=done?q.eq('stage',3):q.lt('stage',3);
            const result=await q;listingResult(result,account);
            if(!Number.isSafeInteger(result.count)||result.count<0)throw Error('Job count unavailable');
            return result.count;
        };
        const [active,done]=await Promise.all([count(false),count(true)]);
        return {active,done};
    }
    const messageResult=async(q,account)=>listingResult(await (typeof q.abortSignal==='function'&&typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?q.abortSignal(AbortSignal.timeout(15000)):q),account);
    const conversationColumns='id,listing_id,owner_id,guest_id,owner_label,guest_label,listing_kind,from_city,to_city,last_message_id,last_message_body,last_sender_id,owner_read_id,guest_read_id,unread_count,created_at,updated_at';
    const messageColumns='id,conversation_id,sender_id,client_nonce,body,created_at';
    const messageID=id=>Number.isSafeInteger(id)&&id>0;
    async function listConversations(before=null) {
        const account=listingAccount();
        let q=requireClient().from('message_inbox').select(conversationColumns).order('last_message_id',{ascending:false}).order('id',{ascending:false}).limit(50);
        if(before!==null) {
            if(!messageID(before.id)||!Number.isSafeInteger(before.activity)||before.activity<0)throw Error('Invalid cursor');
            q=q.or('last_message_id.lt.'+before.activity+',and(last_message_id.eq.'+before.activity+',id.lt.'+before.id+')');
        }
        return messageResult(q,account);
    }
    async function listMessages(id,before=null) {
        const account=listingAccount();if(!messageID(id)||(before!==null&&!messageID(before)))throw Error('Invalid conversation');
        let q=requireClient().from('conversation_messages').select(messageColumns).eq('conversation_id',id).order('id',{ascending:false}).limit(50);
        if(before!==null)q=q.lt('id',before);
        return messageResult(q,account);
    }
    async function openConversation(id) {
        const account=listingAccount();if(!messageID(id))throw Error('Invalid listing');
        return messageResult(requireClient().rpc('nakgo_open_conversation',{p_listing_id:id}),account);
    }
    async function sendMessage(id,body,nonce) {
        const account=listingAccount();
        if(!messageID(id)||typeof body!=='string'||!body.trim()||body.trim().length>500||typeof nonce!=='string'||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(nonce))throw Error('Invalid message');
        return messageResult(requireClient().rpc('nakgo_send_message',{p_conversation_id:id,p_body:body.trim(),p_client_nonce:nonce}),account);
    }
    async function readConversation(id,through) {
        const account=listingAccount();if(!messageID(id)||!messageID(through))throw Error('Invalid boundary');
        return messageResult(requireClient().rpc('nakgo_read_conversation',{p_conversation_id:id,p_through_id:through}),account);
    }
    async function unreadMessages() {
        const account=listingAccount();return messageResult(requireClient().rpc('nakgo_message_unread_count'),account);
    }
    const applicationColumns='id,owner_id,owner_label,license_class,status,revision,created_at,submitted_at,reviewed_at,reviewed_by,review_note,updated_at';
    const documentColumns='id,application_id,owner_id,kind,object_path,status,byte_size,created_at,updated_at';
    const documentUUID=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
    const documentPath=f=>f&&documentUUID(f.id)&&documentUUID(f.owner_id)&&messageID(f.application_id)&&f.object_path===f.owner_id+'/'+f.application_id+'/'+f.id+'.jpg';
    async function documentRole(){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_document_reviewer'),account);}
    async function documentApplications(review=false,before=null){
        const account=listingAccount();if(typeof review!=='boolean'||(before!==null&&!messageID(before)))throw Error('Invalid document query');
        let q=requireClient().from('carrier_applications').select(applicationColumns).order('id',{ascending:false}).limit(20);
        q=review?q.neq('owner_id',account.id).eq('status','submitted'):q.eq('owner_id',account.id);
        if(before!==null)q=q.lt('id',before);return messageResult(q,account);
    }
    async function documentApplication(id){const account=listingAccount();if(!messageID(id))throw Error('Invalid application');return messageResult(requireClient().from('carrier_applications').select(applicationColumns).eq('id',id).maybeSingle(),account);}
    async function documentFiles(id){const account=listingAccount();if(!messageID(id))throw Error('Invalid application');return messageResult(requireClient().from('carrier_document_files').select(documentColumns).eq('application_id',id).neq('status','removed').limit(3),account);}
    async function createDocumentApplication(license){const account=listingAccount();if(!['B','C','CE','D'].includes(license))throw Error('Invalid license');return messageResult(requireClient().rpc('nakgo_create_carrier_application',{p_license:license}),account);}
    async function reserveDocument(id,kind,fileID){const account=listingAccount();if(!messageID(id)||!['src','kb','ruh'].includes(kind)||!documentUUID(fileID))throw Error('Invalid document');return messageResult(requireClient().rpc('nakgo_reserve_document',{p_application_id:id,p_kind:kind,p_file_id:fileID}),account);}
    async function finalizeDocument(id){const account=listingAccount();if(!documentUUID(id))throw Error('Invalid document');return messageResult(requireClient().rpc('nakgo_finalize_document',{p_file_id:id}),account);}
    async function storageDeadline(operation){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Storage timeout')),30000);})]);}finally{clearTimeout(timer);}}
    async function uploadDocument(file,blob){
        const account=listingAccount();if(!documentPath(file)||file.owner_id!==account.id||file.status!=='reserved'||blob?.type!=='image/jpeg'||!Number.isSafeInteger(blob.size)||blob.size<1||blob.size>1048576)throw Error('Invalid upload');
        return listingResult(await storageDeadline(requireClient().storage.from('carrier-documents').upload(file.object_path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'0'})),account);
    }
    async function downloadDocument(file){const account=listingAccount();if(!documentPath(file)||file.status!=='ready')throw Error('Invalid document');return listingResult(await storageDeadline(requireClient().storage.from('carrier-documents').download(file.object_path)),account);}
    async function removeDocument(file){
        const account=listingAccount();if(!documentPath(file)||file.owner_id!==account.id)throw Error('Invalid document');
        listingResult(await storageDeadline(requireClient().storage.from('carrier-documents').remove([file.object_path])),account);
        return messageResult(requireClient().rpc('nakgo_remove_document',{p_file_id:file.id}),account);
    }
    async function transitionDocuments(id,action,revision){const account=listingAccount();if(!messageID(id)||!messageID(revision)||!['submit','withdraw'].includes(action))throw Error('Invalid application transition');return messageResult(requireClient().rpc('nakgo_transition_documents',{p_application_id:id,p_action:action,p_revision:revision}),account);}
    async function reviewDocuments(id,decision,note,revision){const account=listingAccount();if(!messageID(id)||!messageID(revision)||!['approved','rejected'].includes(decision)||typeof note!=='string'||note.trim().length>500||(decision==='rejected'&&note.trim().length<3))throw Error('Invalid review');return messageResult(requireClient().rpc('nakgo_review_documents',{p_application_id:id,p_decision:decision,p_note:note.trim(),p_revision:revision}),account);}
    async function carrierVerifications(ids){const account=listingAccount();if(!Array.isArray(ids)||ids.length>100||!ids.every(documentUUID))throw Error('Invalid user list');return messageResult(requireClient().rpc('nakgo_carrier_verifications',{p_users:[...new Set(ids)]}),account);}
    async function requestTransport(id) {
        const account=listingAccount();if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid listing');
        return listingResult(await requireClient().rpc('nakgo_request_transport',{p_listing_id:id}),account);
    }
    async function transitionTransport(id,action) {
        const account=listingAccount();
        if(!Number.isSafeInteger(id)||id<1||!['accept','reject','withdraw','loaded','confirm'].includes(action))throw Error('Invalid transition');
        return listingResult(await requireClient().rpc('nakgo_transition_transport',{p_job_id:id,p_action:action}),account);
    }
    async function adminPage(section,offset=0,search=''){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_admin_page',{p_section:section,p_offset:offset,p_search:search}),account);}
    async function adminModerate(kind,target,action,reason,expectedRevision){
        const account=listingAccount();
        if(!['user','listing'].includes(kind)||typeof target!=='string'||typeof reason!=='string'||reason.trim().length<3||reason.trim().length>500||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid moderation');
        return messageResult(requireClient().rpc('nakgo_admin_moderate',{p_kind:kind,p_target:target,p_action:action,p_reason:reason.trim(),p_revision:expectedRevision}),account);
    }
    return {adminModerate,adminPage,init,snapshot,message,configOK,signIn,signInGoogle,signUp,recover,password,signOut,saveProfile,saveProfileDetails,listListings,createListing,updateListing,listJobs,jobCounts,listFavorites,setFavorite,listConversations,listMessages,openConversation,sendMessage,readConversation,unreadMessages,documentRole,documentApplications,documentApplication,documentFiles,createDocumentApplication,reserveDocument,finalizeDocument,uploadDocument,downloadDocument,removeDocument,transitionDocuments,reviewDocuments,carrierVerifications,requestTransport,transitionTransport};
})();

// Real listings are session-scoped; demo state never receives account records.
const nakgoMarket = (() => {
    let account='', generation=0, writes=0, demo=null, busy=false, error='', feedBefore=null, ownBefore=null, feedMore=false, ownMore=false;
    const active=()=>!!account;
    const token=()=>account+':'+generation;
    const pending=()=>{toast('Bu özellik gerçek hesaplar için henüz hazır değil.');return false;};
    function empty() {
        loads=[]; trucks=[]; offers=[]; incoming=[]; chats={}; favs=[]; alerts=[]; blocked=[]; reports=[]; rates=[]; cdocs={};
        myCar={lic:'',src:false,kb:false,ruh:false}; prem={until:0,plan:''};
        carriers={}; names={}; appr={}; events=[]; allO=[]; seen=new Set(); cmp=[]; postDrafts=null; postImg='';
    }
    function sync(s) {
        const next=s.marketplace && s.user && !s.recovery ? s.user.id : '';
        if(next!==account) {
            generation++; busy=false; error=''; feedBefore=ownBefore=null; feedMore=ownMore=false;
            if(!account && next) demo={data:JSON.parse(JSON.stringify(stateData())),incoming,carriers,names,appr,events,allO,seen};
            empty(); account=next; nakgoJobs.reset(); nakgoFavorites.reset(); nakgoMessages.reset(); nakgoDocuments.reset();
            if(!next && demo) {
                applyState(demo.data); ({incoming,carriers,names,appr,events,allO,seen}=demo); demo=null;
            }
            closeSheet(); $('#sheetBody').innerHTML=''; loaded=!next; render();
        }
        if(next && s.profile && !loaded && !busy) refresh();
        if(next && s.profile)nakgoFavorites.ensure();
    }
    function mapped(r) {
        return {id:r.kind==='truck'?'t'+r.id:r.id,remoteId:r.id,_remote:true,uid:r.owner_id,mine:r.owner_id===account,
            from:r.from_city,to:r.to_city,veh:r.vehicle,body:r.body,ton:Number(r.amount),cap:Number(r.amount),cargo:r.cargo,
            owner:r.owner_label,who:r.owner_label,date:r.available_on,dateEnd:r.available_until||'',time:r.available_time||'',note:r.note,
            items:r.items||[],img:imgOk(r.image_data)?r.image_data:'',closed:r.status!=='active',archived:r.status==='archived',
            ts:Date.parse(r.created_at),rate:'Yeni'};
    }
    function put(rows,replace=false) {
        const records=new Map((replace?[]:[...loads,...trucks]).map(x=>[x.remoteId,x]));
        rows.forEach(r=>records.set(r.id,mapped(r)));
        const all=[...records.values()].filter(x=>!x.archived).sort((a,b)=>b.remoteId-a.remoteId);
        loads=all.filter(x=>typeof x.id==='number'); trucks=all.filter(x=>typeof x.id==='string');
    }
    async function refresh(more=false) {
        if(!account || busy)return;
        const owner=token(), startedWrites=writes; busy=true; error=''; if(!more)loaded=false; render();
        try {
            const [feed,own]=await Promise.all([
                !more||feedMore?nakgoAuth.listListings({before:more?feedBefore:null}):Promise.resolve([]),
                !more||ownMore?nakgoAuth.listListings({own:true,before:more?ownBefore:null}):Promise.resolve([])
            ]);
            if(owner!==token() || startedWrites!==writes)return;
            if(!more||feedMore){feedMore=feed.length===50;feedBefore=feed.at(-1)?.id||null;}
            if(!more||ownMore){ownMore=own.length===50;ownBefore=own.at(-1)?.id||null;}
            put([...feed,...own],!more);
            nakgoDocuments.refreshPublic([...new Set([...loads,...trucks].map(x=>x.uid))]);
        } catch(e) {if(owner===token())error='İlanlar yüklenemedi. Bağlantını kontrol edip yeniden dene.';}
        finally {if(owner===token()){busy=false;loaded=true;render();}}
    }
    function payload(x,truck) {
        const dates=dateFields(x.date);
        return {kind:truck?'truck':'load',from_city:x.from,to_city:x.to,vehicle:x.veh,body:x.body,amount:truck?x.cap:x.ton,
            cargo:truck?'':x.cargo,note:x.note||'',available_on:dates.date,available_until:dates.dateEnd||null,available_time:x.time||'',
            items:truck?[]:x.items||[],image_data:truck?'':x.img||''};
    }
    async function create(x,truck=false) {
        const owner=token(), row=await nakgoAuth.createListing(payload(x,truck));
        if(owner!==token())throw Error('Account changed'); writes++; put([row]); return row;
    }
    async function update(k,id,patch) {
        const x=findIt(k,id); if(!x?._remote || !x.mine)throw Error('Own listing required');
        const owner=token(), values={};
        if('note' in patch)values.note=patch.note;
        if('cap' in patch)values.amount=patch.cap;
        if('date' in patch){const dates=dateFields(patch.date);values.available_on=dates.date;values.available_until=('dateEnd' in patch?patch.dateEnd:patch.date===x.date?x.dateEnd:dates.dateEnd)||null;}
        if('closed' in patch)values.status=patch.closed?'closed':'active';
        if(patch.archived)values.status='archived';
        const row=await nakgoAuth.updateListing(x.remoteId,values);
        if(owner!==token())throw Error('Account changed'); writes++; put([row]); nakgoFavorites.updateListing(row); render(); return true;
    }
    function controls() {
        if(!active())return '';
        return '<p class="demo-note" role="status">'+(error?esc(error):'Test ortamı · İlanlar, fotoğraflar, taşıma talepleri, favorilerin ve mesajların hesabında saklanır.')+'</p>'+
            '<div class="chips"><button class="chip" id="market-refresh" '+(busy?'disabled':'')+'>İlanları yenile</button>'+((feedMore||ownMore)?'<button class="chip" id="market-more" '+(busy?'disabled':'')+'>Daha fazla ilan yükle</button>':'')+'</div>';
    }
    return {active,token,sync,refresh,create,update,pending,controls,mapped};
})();

// Transport jobs are held only in the verified account session, never the demo store.
const nakgoJobs = (() => {
    let rows=[],busy=false,ready=false,error='',before=null,more=false,version=0;
    let counts={active:0,done:0,ready:false,busy:false,error:''};
    const pending=new Set();
    const reset=()=>{rows=[];busy=false;ready=false;error='';before=null;more=false;version++;pending.clear();counts={active:0,done:0,ready:false,busy:false,error:''};};
    const summary=()=>({...counts});
    async function refreshSummary() {
        const auth=nakgoAuth.snapshot();
        if(!nakgoMarket.active()||counts.busy||!auth.user||!auth.profile||auth.recovery)return;
        const account=nakgoMarket.token(),revision=version;counts.busy=true;counts.error='';
        try {
            const data=await nakgoAuth.jobCounts();
            if(account===nakgoMarket.token()&&revision===version)counts={...data,ready:true,busy:true,error:''};
        } catch(e){if(account===nakgoMarket.token()&&revision===version)counts.error='İş sayaçları yüklenemedi. Yeniden dene.';}
        finally {if(account===nakgoMarket.token()){counts.busy=false;if(tab==='me')render();}}
    }
    const state=()=>({rows:rows.map(r=>({...r,listing_snapshot:{...r.listing_snapshot}})),busy,ready,error,more});
    const put=(list,replace=false)=>{const all=new Map((replace?[]:rows).map(r=>[r.id,r]));list.forEach(r=>all.set(r.id,r));rows=[...all.values()].sort((a,b)=>b.id-a.id);};
    async function refresh(append=false,showBusy=true) {
        const auth=nakgoAuth.snapshot();
        if(!nakgoMarket.active()||busy||!auth.user||!auth.profile||auth.recovery)return;
        const account=nakgoMarket.token(),revision=version;busy=true;error='';if(showBusy&&tab==='mine')render();
        try {
            const data=await nakgoAuth.listJobs(append?before:null);
            if(account!==nakgoMarket.token()||revision!==version)return;
            put(data,!append);more=data.length===50;before=data.at(-1)?.id||null;ready=true;counts.ready=false;
        } catch(e){if(account===nakgoMarket.token())error='İşler yüklenemedi. Yeniden dene.';}
        finally {if(account===nakgoMarket.token()){busy=false;if(tab==='mine')render();}}
    }
    async function write(key,operation) {
        if(!nakgoMarket.active())throw Error('Sign in required');
        if(pending.has(key))return null;
        pending.add(key);const account=nakgoMarket.token();
        try {const row=await operation();if(account!==nakgoMarket.token())throw Error('Account changed');version++;put([row]);error='';counts.ready=false;counts.error='';if(tab==='me')render();return row;}
        finally {if(account===nakgoMarket.token())pending.delete(key);}
    }
    const request=id=>write('listing:'+id,()=>nakgoAuth.requestTransport(id));
    const transition=(id,action)=>write('job:'+id,()=>nakgoAuth.transitionTransport(id,action));
    return {reset,state,summary,refreshSummary,refresh,request,transition};
})();

// Private favorite membership and pages never enter the device demo store.
const nakgoFavorites = (() => {
    let ids=new Set(),rows=[],ready=false,busy=false,error='',pageReady=false,pageBusy=false,pageError='',before=null,more=false,version=0;
    const pending=new Set();
    const allowed=()=>{const s=nakgoAuth.snapshot();return nakgoMarket.active()&&s.user&&s.profile&&!s.recovery;};
    const reset=()=>{ids=new Set();rows=[];ready=busy=pageReady=pageBusy=more=false;error=pageError='';before=null;version++;pending.clear();};
    const state=()=>({ready,busy,error,pageReady,pageBusy,pageError,more,count:ids.size});
    const has=id=>ids.has(id);
    const disabled=id=>!ready||pending.has(id);
    const listings=()=>rows.filter(r=>r.listing&&ids.has(r.listing_id)).map(r=>nakgoMarket.mapped(r.listing));
    const unavailable=()=>rows.filter(r=>ids.has(r.listing_id)&&(!r.listing||!availableListing(nakgoMarket.mapped(r.listing),r.listing.kind==='truck'))).map(r=>r.listing_id);
    async function refresh() {
        if(!allowed()||busy)return;
        const account=nakgoMarket.token(),revision=version;busy=true;error='';
        render();
        try {
            let cursor=null;const found=new Set();
            for(;;) {
                const page=await nakgoAuth.listFavorites({before:cursor});
                if(account!==nakgoMarket.token()||revision!==version)return;
                page.forEach(r=>found.add(r.listing_id));
                if(page.length<200)break;
                const next=page.at(-1)?.listing_id;
                if(!Number.isSafeInteger(next)||next<1||(cursor!==null&&next>=cursor))throw Error('Invalid favorite cursor');
                cursor=next;
            }
            ids=found;ready=true;rows=[];pageReady=false;pageError='';before=null;more=false;
        } catch(e){if(account===nakgoMarket.token()&&revision===version)error='Kaydettiklerin yüklenemedi. Yeniden dene.';}
        finally {if(account===nakgoMarket.token()){busy=false;render();}}
    }
    async function refreshPage(append=false) {
        if(!allowed()||!ready||busy||pageBusy)return;
        const account=nakgoMarket.token(),revision=version;pageBusy=true;pageError='';render();
        try {
            const page=await nakgoAuth.listFavorites({before:append?before:null,details:true});
            if(account!==nakgoMarket.token()||revision!==version)return;
            const all=new Map((append?rows:[]).map(r=>[r.listing_id,r]));page.forEach(r=>all.set(r.listing_id,r));
            rows=[...all.values()];before=page.at(-1)?.listing_id||null;more=page.length===50;pageReady=true;
        } catch(e){if(account===nakgoMarket.token()&&revision===version)pageError='Kayıtlı ilanlar yüklenemedi. Yeniden dene.';}
        finally {if(account===nakgoMarket.token()){pageBusy=false;render();}}
    }
    function ensure() {
        if(!allowed())return;
        if(!ready&&!busy&&!error)refresh();
        else if(ready&&!busy&&F.fav&&tab==='list'&&!pageReady&&!pageBusy&&!pageError)refreshPage();
    }
    async function setSaved(id,saved) {
        if(!allowed()||!ready||!Number.isSafeInteger(id)||id<1||typeof saved!=='boolean')throw Error('Favorite unavailable');
        if(pending.has(id))return null;
        const account=nakgoMarket.token();pending.add(id);render();
        try {
            const result=await nakgoAuth.setFavorite(id,saved);
            if(account!==nakgoMarket.token())throw Error('Account changed');
            if(result?.listing_id!==id||result.saved!==saved)throw Error('Invalid favorite response');
            version++;if(saved)ids.add(id);else ids.delete(id);
            rows=rows.filter(r=>r.listing_id!==id);pageReady=false;pageError='';error='';return result;
        } finally {if(account===nakgoMarket.token()){pending.delete(id);render();}}
    }
    const updateListing=row=>{rows=rows.map(r=>r.listing_id===row.id?{...r,listing:row}:r);};
    function controls() {
        const problem=error||pageError;
        return (problem?'<p role="alert">'+esc(problem)+'</p>':'')+
            (!ready&&!problem?'<p role="status">Kaydettiklerin yükleniyor…</p>':'')+
            (F.fav||problem?'<div class="chips"><button class="chip" id="favorites-refresh" '+(busy||pageBusy?'disabled':'')+'>Kaydettiklerimi yenile</button></div>':'');
    }
    function bind() {
        if($('#favorites-refresh'))$('#favorites-refresh').onclick=()=>refresh();
        if($('#favorites-more'))$('#favorites-more').onclick=()=>refreshPage(true);
    }
    return {reset,state,has,disabled,listings,unavailable,refresh,refreshPage,ensure,setSaved,controls,bind,updateListing};
})();

// Private conversations never enter yy2 or the legacy demo chat store.
const nakgoMessages=(()=>{
    let epoch=0,version=0,screen=0,timer=null,opening=false,conversations=[],inboxReady=false,inboxBusy=false,inboxError='',inboxBefore=null,inboxMore=false;
    let current=null,messages=[],messageReady=false,messageBusy=false,messageError='',messageMore=false,messageBefore=null,sending=false,sendError='',retry=null;
    let readBusy=false,lastRead=0,pollGeneration=0,pollDelay=8000,draftAccount='',drafts=new Map(),draftWarning='';
    let summaryChecked=0,unread={count:0,ready:false,busy:false,error:''};
    const allowed=()=>{const a=nakgoAuth.snapshot();return nakgoMarket.active()&&a.user&&a.profile&&!a.recovery;};
    const state=()=>({conversations:conversations.map(x=>({...x})),inboxReady,inboxBusy,inboxError,inboxMore,current:current?{...current}:null,messages:messages.map(x=>({...x})),messageReady,messageBusy,messageError,messageMore,sending,sendError,draft:current?(drafts.get(current.id)?.body||''):'',draftWarning,unread:{...unread}});
    const stop=()=>{pollGeneration++;if(timer!==null&&typeof window?.clearTimeout==='function')window.clearTimeout(timer);timer=null;};
    function reset(){stop();if(draftAccount)try{window?.sessionStorage?.removeItem('ng-message-drafts:'+draftAccount);}catch(e){}drafts=new Map();draftAccount='';draftWarning='';readBusy=false;lastRead=0;pollDelay=8000;epoch++;version++;screen++;opening=false;conversations=[];inboxReady=inboxBusy=inboxMore=false;inboxError='';inboxBefore=null;current=null;messages=[];messageReady=messageBusy=messageMore=sending=false;messageError=sendError='';messageBefore=retry=null;summaryChecked=0;unread={count:0,ready:false,busy:false,error:''};}
    const key=()=>$('#sheetBody').dataset.k;
    const active=()=>key()==='account-inbox'||(current&&key()==='account-chat:'+current.id);
    const same=(account,e)=>account===nakgoMarket.token()&&e===epoch;
    const draw=()=>{if(active())paintAccountMessages();};
    function loadDrafts(){
        const account=nakgoAuth.snapshot().user?.id;if(!account||account===draftAccount)return;
        drafts=new Map();draftAccount=account;draftWarning='';
        try{const data=JSON.parse(window?.sessionStorage?.getItem('ng-message-drafts:'+account)||'[]');
            if(Array.isArray(data))for(const row of data.slice(0,50))if(Number.isSafeInteger(row.id)&&row.id>0&&typeof row.body==='string'&&row.body.length<=500&&(!row.nonce||/^[a-f0-9-]{36}$/i.test(row.nonce)))drafts.set(row.id,{id:row.id,body:row.body,nonce:row.nonce||null});
        }catch(e){draftWarning='Taslağı tarayıcıda saklayamadık. Göndermeden önce depolama erişimini kontrol et.';}
    }
    function saveDraft(body,nonce=null){
        if(!allowed()||!current)return false;loadDrafts();
        const old=drafts.get(current.id),value=String(body).slice(0,500);
        if(value&&!old&&drafts.size>=50){draftWarning='Önce eski mesaj taslaklarından birini tamamla.';return false;}
        const record={id:current.id,body:value,nonce:nonce||(old?.body.trim()===value.trim()?old.nonce:null)};
        if(value)drafts.set(current.id,record);else drafts.delete(current.id);
        try{window?.sessionStorage?.setItem('ng-message-drafts:'+draftAccount,JSON.stringify([...drafts.values()]));draftWarning='';return true;}
        catch(e){draftWarning='Taslağı tarayıcıda saklayamadık. Göndermeden önce depolama erişimini kontrol et.';return false;}
    }
    const atBottom=()=>{const log=$('#msgs');return Number.isFinite(log.clientHeight)&&log.clientHeight>0&&log.scrollHeight-log.scrollTop-log.clientHeight<40;};
    async function acknowledge(){
        if(!allowed()||!current||readBusy||!messageReady||key()!=='account-chat:'+current.id||document.visibilityState==='hidden'||!atBottom())return;
        const through=messages.at(-1)?.id;if(!through||through<=lastRead)return;
        const account=nakgoMarket.token(),e=epoch,view=screen,id=current.id;readBusy=true;
        try{await nakgoAuth.readConversation(id,through);if(same(account,e)&&view===screen){lastRead=Math.max(lastRead,through);version++;unread.ready=false;refreshSummary();}}
        catch(e1){if(same(account,e)&&view===screen)messageError='Okundu bilgisi kaydedilemedi. Yenile ile tekrar dene.';}
        finally{if(same(account,e)&&view===screen){readBusy=false;draw();}}
    }
    function schedule(){
        stop();if(!active()||typeof window?.setTimeout!=='function')return;
        const generation=pollGeneration,account=nakgoMarket.token(),e=epoch,view=screen;
        timer=window.setTimeout(async()=>{
            timer=null;if(!active()||generation!==pollGeneration||!same(account,e)||view!==screen)return;
            if(document.visibilityState!=='hidden'){
                if(key()==='account-inbox')await refreshInbox();else await refreshMessages();
                pollDelay=(key()==='account-inbox'?inboxError:messageError)?Math.min(pollDelay*2,60000):8000;
            }
            if(generation===pollGeneration&&same(account,e)&&view===screen&&active())schedule();
        },pollDelay);
    }
    async function refreshSummary(){
        if(!allowed()||unread.busy)return;
        const account=nakgoMarket.token(),e=epoch,v=version;unread.busy=true;unread.error='';
        try{const count=await nakgoAuth.unreadMessages();if(same(account,e)&&v===version){if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid unread count');unread={count,ready:true,busy:true,error:''};}}
        catch(e1){if(same(account,e)&&v===version)unread.error='Mesaj sayısı yüklenemedi';}
        finally{if(same(account,e)){unread.busy=false;summaryChecked=Date.now();if(tab==='me')render();}}
    }
    function ensure(){if(allowed()&&!unread.busy&&((!unread.ready&&!unread.error)||Date.now()-summaryChecked>15000))refreshSummary();}
    async function refreshInbox(append=false){
        if(!allowed()||inboxBusy)return;
        const account=nakgoMarket.token(),e=epoch,v=version;inboxBusy=true;inboxError='';draw();
        try{const page=await nakgoAuth.listConversations(append?inboxBefore:null);if(!same(account,e)||v!==version)return;
            const initial=!inboxReady,all=new Map((initial?[]:conversations).map(c=>[c.id,c]));page.forEach(c=>all.set(c.id,c));conversations=[...all.values()].sort((a,b)=>b.last_message_id-a.last_message_id||b.id-a.id);inboxReady=true;
            if(append||initial){inboxMore=page.length===50;const last=page.at(-1);inboxBefore=last?{activity:last.last_message_id,id:last.id}:null;}
        }catch(e1){if(same(account,e))inboxError='Görüşmeler yüklenemedi. Yeniden dene.';}
        finally{if(same(account,e)){inboxBusy=false;draw();}}
    }
    function openInbox(){if(!allowed())return;stop();screen++;current=null;messages=[];retry=null;pollDelay=8000;$('#sheetBody').dataset.k='account-inbox';paintAccountMessages();syncDetailViewport();$('#sheet').classList.add('open');unChat=stop;refreshInbox().then(schedule);refreshSummary();}
    async function openListing(id){
        if(!allowed()||opening)return;const account=nakgoMarket.token(),e=epoch,view=++screen;opening=true;stop();
        $('#sheetBody').dataset.k='account-opening';$('#sheetBody').innerHTML='<div class="detail-top"><b>Görüşme açılıyor…</b><button class="chip" id="close">Kapat ×</button></div>';$('#close').onclick=closeSheet;$('#sheet').classList.add('open');
        try{const row=await nakgoAuth.openConversation(id);if(!same(account,e)||view!==screen||key()!=='account-opening')return;openConversation(row);}
        catch(e1){if(same(account,e)&&view===screen&&key()==='account-opening'){closeSheet();toast('Görüşme açılamadı. İlanları yenileyip tekrar dene.');}}
        finally{if(same(account,e))opening=false;}
    }
    function openConversation(row){
        if(!allowed())return;stop();screen++;loadDrafts();current={...row};messages=[];readBusy=false;lastRead=Number(row.owner_id===nakgoAuth.snapshot().user.id?row.owner_read_id:row.guest_read_id)||0;pollDelay=8000;messageReady=messageBusy=messageMore=sending=false;messageError=sendError='';messageBefore=null;const draft=drafts.get(row.id);retry=draft?.nonce?{id:row.id,body:draft.body.trim(),nonce:draft.nonce}:null;
        $('#sheetBody').dataset.k='account-chat:'+row.id;paintAccountMessages();syncDetailViewport();$('#sheet').classList.add('open');unChat=stop;refreshMessages().then(schedule);
    }
    async function refreshMessages(append=false){
        if(!allowed()||!current||messageBusy||sending)return;
        const account=nakgoMarket.token(),e=epoch,view=screen,v=version,id=current.id;messageBusy=true;messageError='';draw();
        try{const page=await nakgoAuth.listMessages(id,append?messageBefore:null);if(!same(account,e)||view!==screen||v!==version)return;
            const overlaps=page.some(m=>messages.some(old=>old.id===m.id));
            const keep=append||overlaps;
            const all=new Map((keep?messages:[]).map(m=>[m.id,m]));page.forEach(m=>all.set(m.id,m));messages=[...all.values()].sort((a,b)=>a.id-b.id);
            if(append||!keep){messageMore=page.length===50;messageBefore=messages[0]?.id||null;}messageReady=true;
            draw();
            await acknowledge();
        }catch(e1){if(same(account,e)&&view===screen)messageError='Mesajlar yüklenemedi. Yeniden dene.';}
        finally{if(same(account,e)&&view===screen){messageBusy=false;draw();}}
    }
    async function send(body){
        if(!allowed()||!current||sending||typeof body!=='string'||!body.trim()||body.trim().length>500)return null;
        const account=nakgoMarket.token(),e=epoch,view=screen,id=current.id,text=body.trim();
        if(!retry||retry.id!==id||retry.body!==text){if(typeof window?.crypto?.randomUUID!=='function')throw Error('Secure message ID unavailable');retry={id,body:text,nonce:window.crypto.randomUUID()};}
        const request={...retry};if(!saveDraft(text,request.nonce)){sendError=draftWarning;draw();throw Error('Message draft storage unavailable');}sending=true;sendError='';draw();
        try{const row=await nakgoAuth.sendMessage(id,text,request.nonce);if(!same(account,e)||view!==screen)throw Error('Account or conversation changed');
            if(row.conversation_id!==id||row.body!==text||row.sender_id!==nakgoAuth.snapshot().user.id||row.client_nonce!==request.nonce)throw Error('Invalid message response');
            version++;const all=new Map(messages.map(m=>[m.id,m]));all.set(row.id,row);messages=[...all.values()].sort((a,b)=>a.id-b.id);messageReady=true;retry=null;saveDraft('');unread.ready=false;return row;
        }catch(e1){if(same(account,e)&&view===screen)sendError='Mesaj gönderilemedi. Yazdığın metin korunuyor; tekrar dene.';throw e1;}
        finally{if(same(account,e)&&view===screen){sending=false;draw();refreshSummary();}}
    }
    return {reset,state,ensure,refreshSummary,refreshInbox,openInbox,openListing,openConversation,refreshMessages,acknowledge,saveDraft,send,stop};
})();
