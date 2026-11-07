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

- Mevcut Supabase erişimini ve gerektiğinde kullanılacak silme yetkisini koru; erişim değişiklik onayı değildir. Mevcut yüksek yetkili bağlantı bu talimatları teknik olarak zorlamaz. AGENTS.md ile güvenlik veya onay sınırı çelişirse daha koruyucu kuralı uygula.
- SELECT ve salt okunur analizler, görev kapsamındaki kod geliştirme, yerel migration hazırlığı ve izole sentetik testler için ek onay isteme. Uzak DEV veya Production veri/şema değişikliklerinde (INSERT, UPDATE, ALTER dahil) ilgili işleme özel açık onay al; yerel hazırlığı uzakta kendiliğinden uygulama.
- Gerçek verilerde DELETE, TRUNCATE, DROP, CASCADE, toplu temizleme, hesap silme, Storage dosya silme, yıkıcı migration ve RPC/Edge Function/script/otomasyon üzerinden dolaylı silmeler için daima ayrı açık onay al. Belirsiz kayıtları, gerçek kullanıcı verilerini veya yedekleri kendiliğinden silme.
- Gerçek veri/şema değişikliği öncesinde hedef ortamı, etkilenecek verileri, nedeni, yedek durumunu ve geri dönüş imkânını kısa bildir; silmede kayıt sayısını ve silinecek veri türünü de belirt. Sayı veya yedek doğrulanmamışsa bunu açıkça bildir; var olmayan yedeği hazır kabul etme.
- Onayı yalnız belirtilen işlem ve ortamda kullan; Production için ayrıca açık Production onayı al, DEV iznini Production'a taşıma. Önceki onayları farklı işlem veya ortama genelleme; kullanıcının sessizliğini onay sayma.
- Otomatik temizlik/Cron etkinleştirmesi için ayrıca açık onay al. Önceden açıkça onaylanmış zamanlanmış temizlik politikası yalnız kendi kapsamı içinde çalışabilir; kapsam veya süre değişirse yeniden onay al.
- Güvenlik, RLS, KVKK, veri bütünlüğü ve yetkilendirme kontrollerini koru. Yetki/RLS gevşetme, güvenlik denetimini kapatma veya yedekleri değiştirme işlemlerini otomatik yapma; hata çözmek için korumayı ya da testleri zayıflatma. Canlı verilerde test yapma; yerel, sentetik ve geri alınabilir testleri kullan.
- GitHub main birleşmesi, canlı deploy, DNS değişikliği ve ücretli servis etkinleştirme için ayrıca açık onay al. Normal geliştirmede gereksiz onay isteme; yalnız gerçek veri, canlı servis, güvenlik veya maliyet etkisi olan işlemlerde onay sınırında dur. Bir komutun doğrudan/dolaylı etkisi belirsizse çalıştırmadan önce doğrula; güvenli yerel hazırlığı tamamlayıp incelenebilir sonucu sun.
- Gelecekte gerçek silmeyi, ortam ve işlem/kayıt kapsamına bağlı, süreli ve tek kullanımlık onay belirteciyle sunucuda doğrulayan bir yetki kapısını değerlendir; yüksek yetkili doğrudan yolların bu kapıyı aşabildiğini hesaba kat. Bu değerlendirme yeni altyapı kurma veya erişim yetkilerini değiştirme izni vermez.
- Sırları, kişisel verileri ve özel dosya içeriklerini sohbet, log, istemci veya Git'e taşıma. Gerekli erişimi güvenli yerel giriş veya uygun servis arayüzüyle sağla.

## Doğrulama ve kısa teslim

- Değişen davranışın kapsamına ve riskine uygun testleri seç. Etkilenmeyen testleri gereksiz yere tekrarlama; gerekli regresyon ve güvenlik kontrollerini atlama.
- Mock, yerel, CI ve gerçek DEV sonuçlarını ayrı bildir. Bir katmanın başarısını diğerine, test geçişini de yayın veya gerçek veri kabulüne kanıt sayma.
- Çalıştırılmayan, süre aşımına uğrayan, başarısız veya erişim nedeniyle doğrulanamayan kontrolleri açık bırak. Yedek, restore ve otomatik etkinleşme dahil hiçbir sonucu kanıtsız başarılı gösterme.
- Sonucu kısa Türkçe bildir: yapılan işlem, geçen ilgili kontroller ve kalan gerçek engeller veya zorunlu kullanıcı işlemleri. Ek hafıza sistemi veya gereksiz belge üretme.
