---
name: nakgo-engineering
description: NakGo deposunda kod, yapılandırma, veritabanı veya geliştirme araçlarını değiştirirken güncel kaynağa dayalı, sınırlı ve doğrulanabilir mühendislik çalışması yürüt.
---

# NakGo Engineering

## Öncelik ve güncel gerçek

- Güncel kullanıcı talebini ve geçerli AGENTS.md kurallarını esas al; bu Skill onların yerine geçmez ve yeni işlem yetkisi vermez.
- Önce görev kapsamını, mevcut dalı ve yerel değişiklikleri kontrol et. Kullanıcının çalışmalarını koru.
- İlgili dosyaları hedefli aramayla bul; davranışı güncel kaynak kodu, yapılandırma ve gerektiğinde salt okunur ortam kanıtıyla doğrula.
- AGENTS.md'nin zorunlu okumalarını yerine getir; diğer belgelerin yalnız görev için gerekli bölümlerini incele. Tüm projeyi veya uzun geçmiş belgelerini her görevde yeniden okuma.
- Eski belge, rapor ve kararları tarihli bağlam olarak değerlendir; güncel gerçek ya da yeni işlem onayı sayma. Kaynaklar çelişirse ilgili kanıtı doğrula, belirsizliği gizleme.
- Plan/kota, kapasite, saklama, özellik ve mimari kararlarını güncel kullanıcı talebi ve doğrulanmış yapılandırmadan çıkar. Geçmiş ürün veya altyapı seçimlerini kalıcı kısıta dönüştürme.

## Uygulama ve bağımsız ilerleme

- Genel kodlama disiplini için Karpathy Guidelines'ı uygula; aynı ilkeleri burada yeniden çoğaltma.
- Kullanıcı mimari değişikliği istemedikçe çalışan mimariyi koru. Gereksiz refactor, bağımlılık, özellik veya ilgisiz dosya değişikliği ekleme.
- Hataları yalnız raporlama: nedeni belirle, görev kapsamında güvenli düzeltmeyi yap ve sonucunu doğrula. Teknik engelleri mümkün olduğunca bağımsız çöz; eksik bilgi gerçekten gerekli olduğunda somut engeli ve gerekli kullanıcı işlemini belirt.
- Küçük işler için uzun plan üretme. Tekrarlanan analizleri, büyük log çıktılarını ve gereksiz raporları azalt; güvenlik veya doğrulamadan ödün verme.

## Güvenlik ve işlem sınırları

- Supabase, Cloudflare, GitHub veya başka bir servise erişim, değişiklik yetkisi vermez. Dış servislerde varsayılan davranış salt okunur erişimdir; bu Skill ek işlem yetkisi veya teknik salt okunur koruması sağlamaz. Bağlantının gerçek yetkilerini veri değiştirmeden doğrula; yüksek yetkili erişimi açıkça bildir. AGENTS.md ile güvenlik veya onay sınırı çelişirse daha koruyucu kuralı uygula.
- Kullanıcı o işlem için açıkça onay vermedikçe uzak DEV veya Production veritabanında veri ekleme, değiştirme, silme, toplu temizleme, migration veya şema değişikliği yapma. DELETE, TRUNCATE, DROP, UPDATE, INSERT, ALTER ve benzeri işlemler buna dahildir; RPC, Edge Function, script veya otomasyon üzerinden dolaylı değişiklikler de aynı kurala tabidir.
- Özellik geliştirme talebi kapsamında gerekli kodu ve migration dosyalarını hazırla, yerel veya izole sentetik ortamda doğrula; bunları uzak veritabanına kendiliğinden uygulama.
- Gerçek veritabanı değişikliğinden önce hedef ortamı, etkilenecek verileri, işlemin nedenini, mevcut yedeğin durumunu, yedek ve geri dönüş planını açıkla; kullanıcıdan o işleme özel açık onay al. Var olmayan veya doğrulanmamış yedeği hazır kabul etme.
- Production işlemleri için ayrıca açık Production onayı al; DEV iznini Production izni sayma. Onayı yalnız belirtilen işlem ve ortam için kullan; önceki onayları sonraki işlemlere taşıma.
- Güvenlik, RLS, KVKK, veri bütünlüğü ve yetkilendirme kontrollerini koru. Yetki/RLS gevşetme, güvenlik denetimini devre dışı bırakma, bilinmeyen kayıtları silme veya yedekleri değiştirme işlemlerini otomatik gerçekleştirme. Hata çözmek için korumayı kapatma veya testleri zayıflatma.
- Canlı verilerde test yapma; mümkün olduğunca yerel, sentetik ve geri alınabilir testler kullan. Salt okunur gerçek ortam incelemesini testten ayrı tut.
- GitHub main birleşmesi, canlı deploy, DNS değişikliği, ücretli servis etkinleştirme ve zamanlanmış veri temizliği için ayrıca açık kullanıcı onayı al.
- Bir komutun doğrudan veya dolaylı veri/şema değiştirip değiştirmediğinden emin değilsen çalıştırmadan önce etkisini doğrula. Onay gerektiren işlem için güvenli yerel hazırlığı tamamla ve incelenebilir sonucu sun; hazırlık veya servis erişimi uygulama onayı değildir.
- Sırları, kişisel verileri ve özel dosya içeriklerini sohbet, log, istemci veya Git'e taşıma. Gerekli erişimi güvenli yerel giriş veya uygun servis arayüzüyle sağla.

## Doğrulama ve kısa teslim

- Değişen davranışın kapsamına ve riskine uygun testleri seç. Etkilenmeyen testleri gereksiz yere tekrarlama; gerekli regresyon ve güvenlik kontrollerini atlama.
- Mock, yerel, CI ve gerçek DEV sonuçlarını ayrı bildir. Bir katmanın başarısını diğerine, test geçişini de yayın veya gerçek veri kabulüne kanıt sayma.
- Çalıştırılmayan, süre aşımına uğrayan, başarısız veya erişim nedeniyle doğrulanamayan kontrolleri açık bırak. Yedek, restore ve otomatik etkinleşme dahil hiçbir sonucu kanıtsız başarılı gösterme.
- Sonucu kısa Türkçe bildir: yapılan işlem, geçen ilgili kontroller ve kalan gerçek engeller veya zorunlu kullanıcı işlemleri. Ek hafıza sistemi veya gereksiz belge üretme.
