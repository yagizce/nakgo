/* Production connection remains opt-in and cannot cross the DEV/PROD boundary. */
module.exports = ({test}) => {
    test('Production Auth açık izin ve doğru proje gerektirir', async()=>{
        const {publicAuthConfig}=await import('../../api/auth/config.mjs');
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        const prodURL='https://fimlifldsivecezbxwuo.supabase.co';
        const devURL='https://axkotffqrsddbrazhcwj.supabase.co';
        const good={VERCEL_ENV:'production',NAKGO_AUTH_ENABLED:'true',NAKGO_PRODUCTION_AUTH_ENABLED:'true',SUPABASE_URL:prodURL,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_key_for_unit_test'};
        const enabled=publicAuthConfig(good);
        ok(enabled?.enabled&&enabled.url===prodURL&&enabled.marketplaceEnabled===true,'explicit production configuration enables PROD');
        for(const value of [undefined,'','false','TRUE','1']) {
            ok(publicAuthConfig({...good,NAKGO_PRODUCTION_AUTH_ENABLED:value})?.enabled===false,'production switch fails closed: '+String(value));
            ok(publicAuthConfig({...good,NAKGO_AUTH_ENABLED:value})?.enabled===false,'shared switch fails closed: '+String(value));
        }
        for(const url of [devURL,'https://abcdefghijklmnopqrst.supabase.co',prodURL+'/',prodURL+'@evil.example','http://fimlifldsivecezbxwuo.supabase.co','']) {
            ok(publicAuthConfig({...good,SUPABASE_URL:url})===null,'reject wrong production project: '+url);
        }
        for(const mode of ['preview','development',undefined,'custom']) {
            ok(publicAuthConfig({...good,VERCEL_ENV:mode})===null,'PROD project rejected outside production: '+String(mode));
        }
        ok(publicAuthConfig({...good,VERCEL_ENV:'preview',SUPABASE_URL:devURL})?.enabled===true,'DEV preview remains enabled');
        for(const key of ['sb_secret_synthetic_private_key','eyJ.legacy.token','']) {
            ok(publicAuthConfig({...good,SUPABASE_PUBLISHABLE_KEY:key})===null,'private or missing key rejected in production');
        }
        const limited=publicAuthConfig({...good,SUPABASE_SERVICE_ROLE_KEY:'never-expose',NAKGO_ADMIN_EMAIL:'never-expose'});
        ok(JSON.stringify(Object.keys(limited).sort())===JSON.stringify(['enabled','marketplaceEnabled','publishableKey','url']),'only public browser fields returned');
        ok(!JSON.stringify(limited).includes('never-expose'),'server-only values are never copied to browser config');
        return out;
    });
};
