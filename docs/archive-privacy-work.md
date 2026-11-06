# Arşiv ve veri hakları — 6 Kasım 2026

Uygulama kaynağı `bc98998`, Draft PR44; dokuz migration ve uyumlu Worker yalnız
Supabase DEV / nakgo-app-dev'e uygulandı. Production uygulaması/DB/DNS değişmedi.
Onaylı PR45 yalnız kontrol ledger'ı/belgesini main 49d1de1'e aldı; Vercel başarılı,
yönetici bypass engeli tekrar açık. PR44 ve eski uygulama PR'ları birleşmedi.

- 6 saat görünürlük + 8 gün yetkili arşiv, filtreler, ayrı arşiv/iletişim/KVKK kapsamları.
- Başvuru ve 30 günlük yanıt takibi, sınırlı hesap silme, süreli hukuki koruma,
  içerik taşımayan 3 yıllık silme kanıtı ve hatalı bakım için backoff/uyarı hazır.
- Gerçek hesap silme, Cron, purge ve Meta kapalı. Bilinmeyen/hukuki ilişkiler korunur.
- Dokuzlu native restore provası geçti: 60 tablo/465 satır, eski değerler/izinler korundu.
  Şifreli yedekler Git dışında; açık geçici kopyalar kaldırıldı. Auth/Storage servis
  restore'ının tamamı bu PostgreSQL provasıyla doğrulanmış sayılmaz.
- bc98998 üzerinde dört CI başarılı. Yerel 680 uygulama/63 WhatsApp, 50 moderasyon,
  15 Storage servis-context kontrolü ve arşiv mobil/masaüstü browser kabulü geçti.
- Gerçek DEV: anonim RPC/Worker 401; normal hesapta 17 özel yol 403; diğer hesapların
  ilan/belge metadatası yok, kapsam 0; test oturumu kapatıldı.
- Onaylı tek DEV genel yöneticisine 3 kapsam kalıcı verildi; diğer hesaplarda 0.
  Yönetici arşiv/KVKK ekranları açıldı, listeler boştu; dolu kayıt işlemi kabulü açık.
- Eski sentetik 104 kaynak/103 taslak içerik ve sahiplik kontrolüyle temizlendi;
  diğer public/private satırların SHA-256 özetleri korundu.

Kalan: pozitif dolu arşiv/başvuru kabulü, çapraz hesap gerçek dosya indirme testi,
gerçek 10/20 grup CPU ve yeni saklama düzeninde depolama ölçümü, ilişkili hesapların
silinmesi ve restore sonrası silme manifesti uygulaması. Free yeterliliği kanıtlanmadı.
Veri sorumlusu unvanı/adresi yok; metinler taslak, hukuk/mağaza kabulü tamamlanmadı.
Eski 30 günlük kapasite tahminlerini yeni sözleşmenin kabulü saymayın.
