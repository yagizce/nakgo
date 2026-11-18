-- Yönetici işlemlerinde eşzamanlılık: nakgo_admin_moderate eski revision'da 40001 (serialization_failure) döndürüyordu.
-- PostgREST 40001'i yeniden denenebilir hata sayıp aynı isteği tekrar çalıştırır; revision değişmediği için her deneme
-- yine 40001 olur ve istek yanıtsız kalır. Düzeltme yalnız hata kodunu ve kilit bekleme süresini değiştirir:
--  * 'Moderation changed; refresh' artık PT409 (HTTP 409) ile döner; mesaj ve iş kuralı aynı.
--  * Fonksiyona lock_timeout=5s: başka bir işlem kaydı 5 saniyeden uzun kilitlerse beklemek yerine işlem geri alınır ve
--    'Moderation busy; refresh' PT409 (HTTP 409) döner. Hiçbir değişiklik ve denetim kaydı yazılmaz. Kilit sırası değişmez
--    (hesap: kişi kilidi → yönetici kilidi → satır; ilan: ilan satırı → moderasyon satırı).
-- Fonksiyon gövdesi yeniden yazılmaz: geçerli tanım (mevcut ya da #125'in yasal arşiv sürümü) metin olarak alınır, yalnız
-- bu iki nokta değiştirilir. Beklenen metin yoksa migration durur. Denetim kaydı (admin_audit) ve sıralama aynen kalır.
begin;
do $$ declare d text; n text; k int; begin
 d:=pg_get_functiondef('public.nakgo_admin_moderate(text,text,text,text,bigint)'::regprocedure);
 k:=(length(d)-length(replace(d,'errcode=''40001''','')))/length('errcode=''40001''');
 if k<1 or position('Moderation changed; refresh' in d)=0 then raise exception 'Unexpected nakgo_admin_moderate definition'; end if;
 n:=replace(d,'errcode=''40001''','errcode=''PT409''');
 if position(E'\n SET lock_timeout' in n)=0 then
  n:=replace(n,E'\n SET search_path TO ''''',E'\n SET search_path TO ''''\n SET lock_timeout TO ''5s''');
 end if;
 if position('Moderation busy; refresh' in n)=0 then
  n:=regexp_replace(n,'\send\s*\$function\$\s*$',E'\n exception when lock_not_available then\n  raise exception ''Moderation busy; refresh'' using errcode=''PT409'';\nend $function$\n','i');
 end if;
 if position('errcode=''40001''' in n)>0 or position(E'SET lock_timeout TO ''5s''' in n)=0
  or position('Moderation busy; refresh' in n)=0 then raise exception 'nakgo_admin_moderate patch failed'; end if;
 execute n;
end $$;
commit;
