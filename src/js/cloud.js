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
    const listingColumns='id,owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,note,published_at,expires_at,available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at';
    const listingFields=['from_city','to_city','vehicle','body','amount','cargo','note','available_on','available_until','available_time','loading_text','items','image_data','contact_phone','contact_consent'];
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
        else query=query.eq('status','active').gt('expires_at',new Date().toISOString());
        if(before!==null) {
            if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid cursor');
            query=query.lt('id',before);
        }
        return listingResult(await query,account);
    }
    async function createListing(input) {
        const account=listingAccount();
        if(!['load','truck'].includes(input?.kind))throw Error('Invalid kind');
        const values={kind:input.kind};
        for(const key of listingFields)if(Object.prototype.hasOwnProperty.call(input,key))values[key]=input[key];
        return listingResult(await requireClient().from('listings').insert(values).select(listingColumns).single(),account);
    }
    async function updateListing(id,input) {
        const account=listingAccount();
        if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid listing');
        const values={};
        for(const key of [...listingFields,'status'])if(Object.prototype.hasOwnProperty.call(input,key))values[key]=input[key];
        if(!Object.keys(values).length)throw Error('No editable fields');
        if(['closed','archived'].includes(values.status)){if(Object.keys(values).length!==1)throw Error('Close separately from edits');return listingResult(await requireClient().rpc('nakgo_close_listing',{p_id:id,p_status:values.status}),account);}
        return listingResult(await requireClient().from('listings').update(values).eq('id',id).eq('owner_id',account.id).select(listingColumns).single(),account);
    }
    async function listingContact(id){const account=listingAccount();return listingResult(await requireClient().rpc('nakgo_listing_contact',{p_id:id}),account);}
    const jobColumns='id,listing_id,owner_id,carrier_id,carrier_label,listing_snapshot,status,stage,created_at,updated_at,expires_at,loaded_at,confirmed_at';
    async function listJobs(before=null) {
        const account=listingAccount();
        let q=requireClient().from('transport_jobs').select(jobColumns).order('id',{ascending:false}).limit(50);
        if(before!==null){if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid cursor');q=q.lt('id',before);}
        return listingResult(await q,account);
    }
    async function listFavorites({before=null,details=false}={}) {
        const account=listingAccount();
        const favoriteColumns=listingColumns.split(',').filter(column=>column!=='contact_phone').join(',');
        let q=requireClient().from('listing_favorites').select('listing_id,created_at,listing:listings!inner('+(details?favoriteColumns:'id,owner_id,kind,status,published_at,expires_at')+')')
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
    const messageID=id=>Number.isSafeInteger(id)&&id>0;
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
    async function whatsappRPC(name,args={}){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_wa_'+name,args),account);}
    async function adminRole(){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_admin_role'),account);}
    async function archiveList(search='',before=null,filters={}){
        const account=listingAccount();
        return messageResult(requireClient().rpc('nakgo_archive_list',{p_search:search,p_before:before,p_kind:filters.kind||null,p_source:filters.source||null,p_from:filters.from||null,p_to:filters.to||null,p_review:filters.review||null}),account);
    }
    async function dataCapabilities(){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_data_capabilities'),account);}
    async function maintenanceStatus(){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_maintenance_status'),account);}
    async function privacyRPC(name,args={}){if(!['request','requests','queue','resolve'].includes(name))throw Error('Invalid privacy action');const account=listingAccount();return messageResult(requireClient().rpc('nakgo_privacy_'+name,args),account);}
    async function archiveAction(action,args){if(!['review','hold'].includes(action))throw Error('Invalid archive action');const account=listingAccount();return messageResult(requireClient().rpc('nakgo_archive_'+action,args),account);}
    async function archiveDetail(id){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_archive_detail',{p_id:id}),account);}
    async function adminPage(section,offset=0,search=''){const account=listingAccount();return messageResult(requireClient().rpc('nakgo_admin_page',{p_section:section,p_offset:offset,p_search:search}),account);}
    async function adminModerate(kind,target,action,reason,expectedRevision){
        const account=listingAccount();
        if(!['user','listing'].includes(kind)||typeof target!=='string'||typeof reason!=='string'||reason.trim().length<3||reason.trim().length>500||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid moderation');
        return messageResult(requireClient().rpc('nakgo_admin_moderate',{p_kind:kind,p_target:target,p_action:action,p_reason:reason.trim(),p_revision:expectedRevision}),account);
    }
    return {maintenanceStatus,archiveAction,privacyRPC,listingContact,whatsappRPC,adminRole,adminModerate,archiveList,archiveDetail,dataCapabilities,adminPage,init,snapshot,message,configOK,signIn,signInGoogle,signUp,recover,password,signOut,saveProfile,saveProfileDetails,listListings,createListing,updateListing,listJobs,jobCounts,listFavorites,setFavorite,documentRole,documentApplications,documentApplication,documentFiles,createDocumentApplication,reserveDocument,finalizeDocument,uploadDocument,downloadDocument,removeDocument,transitionDocuments,reviewDocuments,carrierVerifications,requestTransport,transitionTransport};
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
        carriers={}; names={}; appr={}; events=[]; allO=[]; seen=new Set(); postDrafts=null; postImg='';
    }
    function sync(s) {
        const next=s.marketplace && s.user && !s.recovery ? s.user.id : '';
        if(next!==account) {
            generation++; busy=false; error=''; feedBefore=ownBefore=null; feedMore=ownMore=false;
            if(!account && next) demo={data:JSON.parse(JSON.stringify(stateData())),incoming,carriers,names,appr,events,allO,seen};
            empty(); account=next; nakgoJobs.reset(); nakgoFavorites.reset(); nakgoDocuments.reset(); nakgoAdminAccess.reset();
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
            owner:'',who:'',phone:r.contact_phone||'',publishedAt:Date.parse(r.published_at),expiresAt:Date.parse(r.expires_at),date:r.available_on||'',dateEnd:r.available_until||'',time:r.available_time||'',...(r.loading_text!=null?{dateText:r.loading_text}:{}),note:r.note,
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
        const dates=!truck&&'dateText' in x?{date:null,dateEnd:''}:dateFields(x.date);
        return {kind:truck?'truck':'load',from_city:x.from,to_city:x.to,vehicle:x.veh,body:x.body,amount:truck?x.cap:x.ton,
            contact_phone:normalizeListingPhone(x.phone),contact_consent:x.contactConsent===true,cargo:truck?'':x.cargo,note:x.note||'',available_on:dates.date,available_until:dates.dateEnd||null,available_time:x.time||'',...(!truck&&'dateText' in x?{loading_text:x.dateText}:{}),
            items:truck?[]:x.items||[],image_data:truck?'':x.img||''};
    }
    async function create(x,truck=false) {
        const owner=token(), row=await nakgoAuth.createListing(payload(x,truck));
        if(owner!==token())throw Error('Account changed'); writes++; put([row]); return row;
    }
    async function update(k,id,patch) {
        const x=findIt(k,id); if(!x?._remote || !x.mine)throw Error('Own listing required');
        const owner=token(), values={};
        if('phone' in patch){values.contact_phone=normalizeListingPhone(patch.phone);values.contact_consent=patch.contactConsent===true;}
        if('note' in patch)values.note=patch.note;
        if('cap' in patch)values.amount=patch.cap;
        if('date' in patch){const dates=dateFields(patch.date);values.available_on=dates.date;values.available_until=('dateEnd' in patch?patch.dateEnd:patch.date===x.date?x.dateEnd:dates.dateEnd)||null;}
        if('dateText' in patch){values.loading_text=patch.dateText;values.available_on=null;values.available_until=null;values.available_time='';}
        if('closed' in patch)values.status=patch.closed?'closed':'active';
        if(patch.archived)values.status='archived';
        const row=await nakgoAuth.updateListing(x.remoteId,values);
        if(owner!==token())throw Error('Account changed'); writes++;if(['closed','archived'].includes(row.status)){loads=loads.filter(item=>item.remoteId!==row.id);trucks=trucks.filter(item=>item.remoteId!==row.id);}else put([row]);nakgoFavorites.updateListing(row);render();return true;
    }
    function controls() {
        if(!active())return '';
        return '<p class="demo-note" role="status">'+(error?esc(error):'Test ortamı · İlanlar, fotoğraflar, taşıma talepleri, favorilerin hesabında saklanır.')+'</p>'+
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
    let ids=new Map(),rows=[],ready=false,busy=false,error='',pageReady=false,pageBusy=false,pageError='',before=null,more=false,version=0;
    const pending=new Set();
    const allowed=()=>{const s=nakgoAuth.snapshot();return nakgoMarket.active()&&s.user&&s.profile&&!s.recovery;};
    const reset=()=>{ids=new Map();rows=[];ready=busy=pageReady=pageBusy=more=false;error=pageError='';before=null;version++;pending.clear();};
    const current=r=>!!r?.listing&&r.listing.status==='active'&&Date.parse(r.listing.published_at)<=Date.now()&&Date.parse(r.created_at)>=Date.parse(r.listing.published_at)&&Date.parse(r.listing.expires_at)>Date.now();
    const has=id=>{
        const saved=ids.get(id),item=[...loads,...trucks].find(x=>x.remoteId===id);
        return current(saved)&&(!item||(availableListing(item)&&item.publishedAt===Date.parse(saved.listing.published_at)));
    };
    const state=()=>({ready,busy,error,pageReady,pageBusy,pageError,more,count:[...ids.keys()].filter(has).length});
    const disabled=id=>!ready||pending.has(id);
    const listings=()=>rows.filter(r=>current(r)&&has(r.listing_id)).map(r=>nakgoMarket.mapped(r.listing)).filter(x=>availableListing(x,typeof x.id==='string'));
    async function refresh() {
        if(!allowed()||busy)return;
        const account=nakgoMarket.token(),revision=version;busy=true;error='';
        render();
        try {
            let cursor=null;const found=new Map();
            for(;;) {
                const page=await nakgoAuth.listFavorites({before:cursor});
                if(account!==nakgoMarket.token()||revision!==version)return;
                page.forEach(r=>{if(current(r))found.set(r.listing_id,r);});
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
            page.forEach(r=>{if(current(r))ids.set(r.listing_id,r);else ids.delete(r.listing_id);});
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
        const item=[...loads,...trucks,...listings()].find(x=>x.remoteId===id);
        if(saved&&(!item||!availableListing(item)))throw Error('Listing unavailable');
        const account=nakgoMarket.token();pending.add(id);render();
        try {
            const result=await nakgoAuth.setFavorite(id,saved);
            if(account!==nakgoMarket.token())throw Error('Account changed');
            if(result?.listing_id!==id||result.saved!==saved)throw Error('Invalid favorite response');
            version++;if(saved)ids.set(id,{listing_id:id,created_at:new Date(Date.now()).toISOString(),listing:{id,kind:typeof item.id==='string'?'truck':'load',status:'active',published_at:new Date(item.publishedAt).toISOString(),expires_at:new Date(listingExpiry(item)).toISOString()}});else ids.delete(id);
            rows=rows.filter(r=>r.listing_id!==id);pageReady=false;pageError='';error='';return result;
        } finally {if(account===nakgoMarket.token()){pending.delete(id);render();}}
    }
    const updateListing=row=>{rows=rows.map(r=>r.listing_id===row.id?{...r,listing:row}:r);if(ids.has(row.id))ids.set(row.id,{...ids.get(row.id),listing:row});};
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
    return {reset,state,has,disabled,listings,refresh,refreshPage,ensure,setSaved,controls,bind,updateListing};
})();
