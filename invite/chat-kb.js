/* Rasumi Agent · knowledge base (English + Bahasa Melayu)
   Every answer comes from how Rasumi Apps really works. Node: { q:[en,ms], a:[en,ms], kw:[...], next:[ids], agent:'key' }
   kw are matched against what the user types (lower case, English and Malay). */
window.RA_KB = (function () {
  var N = {};
  function n(id, q, a, kw, next, extra) { N[id] = Object.assign({ id: id, q: q, a: a, kw: kw || [], next: next || [] }, extra || {}); }

  // ---------------------------------------------------------------- topics (first menu)
  var TOPICS = ['about', 'start', 'apps', 'account', 'trouble', 'tech', 'it'];   // the agents are answered only when someone asks

  // ---------------------------------------------------------------- 0. about Rasumi Apps
  n('about', ['What is Rasumi Apps?', 'Apa itu Rasumi Apps?'],
    ['<b>Rasumi Apps</b> is Rasumi Medipharma\'s own Windows app for staff. It puts daily work in one place:<ul><li><b>Documents</b>: rename, split and clean up scanned invoices, DOs and claim papers (Renamer, Splitter, Scanify, Doc Manager).</li><li><b>Store and purchasing</b>: branch stock, Store Portal, Special Request and PO Mailer linked to AutoCount.</li><li><b>Claims</b>: Vibes Agent sends claim documents to JHEV.</li><li><b>Management</b>: Admin Monitor and Executive reports.</li></ul>In the background, automation keeps the data from VIMS and AutoCount up to date for every branch. You only see the apps your role needs.',
     '<b>Rasumi Apps</b> ialah app Windows milik Rasumi Medipharma untuk staf. Ia himpunkan kerja harian dalam satu tempat:<ul><li><b>Dokumen</b>: namakan, pecahkan dan kemaskan scan invois, DO dan kertas claim (Renamer, Splitter, Scanify, Doc Manager).</li><li><b>Stor dan pembelian</b>: stok cawangan, Store Portal, Special Request dan PO Mailer yang disambung ke AutoCount.</li><li><b>Claim</b>: Vibes Agent hantar dokumen claim ke JHEV.</li><li><b>Pengurusan</b>: Admin Monitor dan laporan Eksekutif.</li></ul>Di belakang tabir, automasi memastikan data dari VIMS dan AutoCount sentiasa terkini untuk setiap cawangan. Anda hanya nampak app yang diperlukan oleh peranan anda.'],
    ['what is rasumi', 'apa itu rasumi', 'about rasumi', 'tentang rasumi', 'rasumi apps ni', 'rasumi apps tu', 'introduce', 'perkenalkan', 'explain rasumi', 'terangkan rasumi', 'overview', 'gambaran'], ['b_who', 'b_role', 'b_why', 'b_cost', 'b_maker', 'w_terms']);
  n('b_who', ['Who uses it?', 'Siapa yang guna?'],
    ['Rasumi staff who are invited by IT: HQ claim and document teams, branch counters and pharmacists, purchasers, Accounts, HR and management. Each person signs in with their own account, so the app shows the right tools and credits the work to the right person.',
     'Staf Rasumi yang dijemput oleh IT: pasukan claim dan dokumen HQ, kaunter dan farmasi cawangan, purchaser, Akaun, HR dan pengurusan. Setiap orang log masuk dengan akaun sendiri, jadi app papar alat yang betul dan kerja dikreditkan kepada orang yang betul.'],
    ['who uses', 'siapa guna', 'siapa pakai', 'who can use', 'siapa boleh guna', 'for who', 'untuk siapa', 'staff only', 'staf sahaja'], ['b_role']);
  n('b_role', ['Which apps will I see?', 'App mana yang saya akan nampak?'],
    ['It depends on the role and branch IT gave you. For example a branch counter sees Scanify and Store Portal, a purchaser sees PO Mailer, and Accounts sees Executive. If an app you need is missing after you sign in, use <b>Leave a message for IT</b> and say which app.',
     'Bergantung pada peranan dan cawangan yang IT tetapkan. Contohnya kaunter cawangan nampak Scanify dan Store Portal, purchaser nampak PO Mailer, dan Akaun nampak Eksekutif. Jika app yang anda perlukan tiada selepas log masuk, guna <b>Tinggalkan mesej untuk IT</b> dan nyatakan app mana.'],
    ['which app', 'app mana', 'my role', 'peranan saya', 'role', 'peranan', 'access', 'akses', 'permission', 'kebenaran', 'cannot see', 'tak nampak', 'missing app', 'app tiada', 'menu tiada', 'request access', 'minta akses'], ['it']);
  n('b_why', ['Why should I use it?', 'Kenapa perlu guna?'],
    ['Less manual work and fewer mistakes: files are named and split for you, stock and POs come straight from AutoCount, claims are tracked DO by DO, and your work is recorded under your name. Everything is in one app instead of many folders, portals and spreadsheets.',
     'Kurang kerja manual dan kurang silap: fail dinamakan dan dipecahkan untuk anda, stok dan PO terus dari AutoCount, claim dijejak DO demi DO, dan kerja anda direkod atas nama anda. Semua dalam satu app, bukan banyak folder, portal dan spreadsheet.'],
    ['why use', 'kenapa guna', 'kenapa perlu', 'benefit', 'faedah', 'kelebihan', 'advantage', 'mandatory', 'wajib', 'must i', 'kena guna', 'perlu guna', 'wajib guna', 'have to use'], []);
  n('b_cost', ['Is it free? Do I need a licence?', 'Percuma ke? Perlu lesen?'],
    ['Yes, it is free for Rasumi staff. It is built in-house, so there is no licence to buy and nothing to pay. You only need the invitation and a Windows PC.',
     'Ya, percuma untuk staf Rasumi. Ia dibina sendiri, jadi tiada lesen untuk dibeli dan tiada bayaran. Anda hanya perlukan jemputan dan PC Windows.'],
    ['how much does it cost', 'berapa harga', 'berapa kos', 'free', 'percuma', 'cost', 'kos', 'price', 'harga', 'bayar', 'pay', 'licence', 'license', 'lesen', 'subscription', 'langganan'], []);
  n('b_maker', ['Who built Rasumi Apps?', 'Siapa bina Rasumi Apps?'],
    ['Rasumi Apps is designed and built in-house by the <b>IT / AI team at Rasumi Medipharma</b>, and keeps improving based on feedback from staff, including messages and ratings from this chat.',
     'Rasumi Apps direka dan dibina sendiri oleh <b>pasukan IT / AI Rasumi Medipharma</b>, dan terus ditambah baik berdasarkan maklum balas staf, termasuk mesej dan rating dari chat ini.'],
    ['who built', 'siapa bina', 'siapa buat', 'who made', 'who developed', 'developer', 'pembangun', 'who created', 'siapa cipta'], []);

  // glossary: words staff meet in the apps
  n('w_terms', ['What do VIMS, AutoCount, DocuShare and JHEV mean?', 'Apa maksud VIMS, AutoCount, DocuShare dan JHEV?'],
    ['These are the systems Rasumi Apps works with. Which one?', 'Ini sistem yang Rasumi Apps bekerja bersama. Yang mana satu?'],
    ['glossary', 'istilah', 'meaning', 'maksud', 'terms'], ['w_vims', 'w_ac', 'w_ds', 'w_jhev', 'w_doc']);
  n('w_vims', ['What is VIMS?', 'Apa itu VIMS?'],
    ['<b>VIMS</b> is the dispensing and claim system used at the counters: sales, DOs, indents and the claim list. Rasumi Apps reads it automatically (VIMS Sync and VIMS Claim Batch); patient details are never copied into reports.',
     '<b>VIMS</b> ialah sistem dispensing dan claim yang digunakan di kaunter: jualan, DO, indent dan senarai claim. Rasumi Apps membacanya secara automatik (VIMS Sync dan VIMS Claim Batch); butiran pesakit tidak pernah disalin ke laporan.'],
    ['what is vims', 'apa itu vims', 'vims tu apa', 'vims apa'], []);
  n('w_ac', ['What is AutoCount?', 'Apa itu AutoCount?'],
    ['<b>AutoCount</b> is the accounting system for each company book (FVKL, FVT, FVL, FVG, RSA): invoices, DOs, POs, GRNs and payments. Rasumi Apps creates POs in it and reads it through the AutoCount Bridge.',
     '<b>AutoCount</b> ialah sistem perakaunan untuk setiap buku syarikat (FVKL, FVT, FVL, FVG, RSA): invois, DO, PO, GRN dan bayaran. Rasumi Apps mencipta PO di dalamnya dan membacanya melalui AutoCount Bridge.'],
    ['what is autocount', 'apa itu autocount', 'autocount tu apa', 'autocount apa'], []);
  n('w_ds', ['What is DocuShare?', 'Apa itu DocuShare?'],
    ['<b>DocuShare</b> is where Rasumi keeps its scanned documents. The Renamer names files the way DocuShare folders expect, and supplier invoices are uploaded there when an order is delivered.',
     '<b>DocuShare</b> ialah tempat Rasumi simpan dokumen yang diimbas. Renamer namakan fail ikut format folder DocuShare, dan invois pembekal dimuat naik ke situ bila order dihantar.'],
    ['what is docushare', 'apa itu docushare', 'docushare tu apa', 'docushare apa'], []);
  n('w_jhev', ['What is JHEV / Vibes?', 'Apa itu JHEV / Vibes?'],
    ['<b>JHEV</b> is the government veterans\' department that pays for veterans\' medicine; <b>Vibes</b> is its online claim portal. Each DO is claimed there, and Rasumi Apps tracks every DO from issued to sent to paid.',
     '<b>JHEV</b> ialah jabatan hal ehwal veteran yang membayar ubat veteran; <b>Vibes</b> ialah portal claim dalam talian. Setiap DO dituntut di situ, dan Rasumi Apps menjejak setiap DO dari dikeluarkan, dihantar hingga dibayar.'],
    ['what is jhev', 'apa itu jhev', 'jhev tu apa', 'jhev apa', 'what is vibes', 'apa itu vibes'], []);
  n('w_doc', ['What are DO, PO, GRN and invoice?', 'Apa itu DO, PO, GRN dan invois?'],
    ['<ul><li><b>DO</b> (delivery order): goods given out, for example medicine dispensed against a claim.</li><li><b>PO</b> (purchase order): what we order from a supplier.</li><li><b>GRN</b> (goods received note): stock received against a PO.</li><li><b>Invoice</b>: the bill, from us to a customer or from a supplier to us.</li></ul>',
     '<ul><li><b>DO</b> (delivery order): barang dikeluarkan, contohnya ubat didispens untuk claim.</li><li><b>PO</b> (purchase order): pesanan kita kepada pembekal.</li><li><b>GRN</b> (goods received note): stok diterima berdasarkan PO.</li><li><b>Invois</b>: bil, dari kita kepada pelanggan atau dari pembekal kepada kita.</li></ul>'],
    ['what is do', 'apa itu do', 'what is grn', 'apa itu grn', 'what is po', 'apa itu po', 'delivery order', 'goods received'], []);

  // ---------------------------------------------------------------- 1. getting started
  n('start', ['Getting started', 'Mula guna'],
    ['Happy to help you get set up. What do you need help with?', 'Saya boleh bantu anda mula. Bahagian mana yang anda perlukan?'],
    ['start', 'mula', 'setup', 'begin', 'getting started', 'first time', 'kali pertama', 'baru join', 'new staff', 'staf baru'], ['s_dl', 's_inst', 's_smart', 's_signup', 's_2fa', 's_valid', 's_link', 's_multi', 's_req']);
  n('s_valid', ['How long is my invitation valid?', 'Berapa lama jemputan saya sah?'],
    [function (c) { var i = c.info || {}; return 'Your invitation works' + (i.expires_at ? ' until <b>' + c.esc(c.date(i.expires_at)) + '</b>' : ' until the date shown on this page') + (i.downloads_left != null ? ' and has <b>' + i.downloads_left + '</b> download' + (i.downloads_left === 1 ? '' : 's') + ' left' : '') + '. Once Rasumi Apps is installed and you have signed up, the invitation is no longer needed: you sign in with your own account from then on.'; },
     function (c) { var i = c.info || {}; return 'Jemputan anda sah' + (i.expires_at ? ' sehingga <b>' + c.esc(c.date(i.expires_at)) + '</b>' : ' sehingga tarikh di page ini') + (i.downloads_left != null ? ' dan berbaki <b>' + i.downloads_left + '</b> muat turun' : '') + '. Selepas Rasumi Apps dipasang dan anda sudah mendaftar, jemputan tidak diperlukan lagi: anda log masuk dengan akaun sendiri.'; }],
    ['how long', 'berapa lama', 'valid', 'sah', 'expiry', 'expire', 'tarikh tamat', 'until when', 'sampai bila', 'downloads left', 'baki muat turun', 'how many download', 'berapa kali'], ['s_link']);
  n('s_multi', ['Can I install on another PC or share the link?', 'Boleh pasang di PC lain atau kongsi link?'],
    ['The invitation is personal and works on one PC. Do not forward it: a colleague who needs Rasumi Apps gets their own invitation from IT. To use Rasumi Apps on a second PC (for example at another branch), ask IT and they will send a new invitation; you sign in there with the same account.',
     'Jemputan ini peribadi dan berfungsi di satu PC. Jangan forward: rakan sekerja yang perlukan Rasumi Apps akan dapat jemputan sendiri dari IT. Untuk guna Rasumi Apps di PC kedua (contohnya di cawangan lain), minta IT dan mereka akan hantar jemputan baharu; anda log masuk di situ dengan akaun yang sama.'],
    ['share', 'kongsi', 'forward', 'colleague', 'rakan', 'kawan', 'second pc', 'pc kedua', 'pc lain', 'another pc', 'other pc', 'computer lain', 'another computer', 'two pc', 'dua pc', 'laptop', 'more than one', 'lebih dari satu', 'home pc', 'pc rumah', 'at home', 'di rumah', 'rumah', 'work from home', 'wfh'], ['it']);
  n('s_dl', ['How do I download Rasumi Apps?', 'Bagaimana muat turun Rasumi Apps?'],
    ['Press <b>Download for Windows</b> on this page. The installer starts downloading straight away.<ul><li>Each download link works for <b>10 minutes</b>; press the button again for a new one.</li><li>After the first download this invitation works <b>on this PC and browser only</b>.</li><li>Office Wi-Fi takes about a minute.</li></ul>',
     'Tekan <b>Download for Windows</b> di page ini. Installer akan terus dimuat turun.<ul><li>Setiap link muat turun sah <b>10 minit</b>; tekan semula untuk link baharu.</li><li>Selepas muat turun pertama, jemputan ini hanya berfungsi <b>di PC dan browser ini</b>.</li><li>Dengan Wi-Fi pejabat, lebih kurang seminit.</li></ul>'],
    ['download', 'muat turun', 'muatturun', 'dl', 'installer', 'exe', 'setup file', 'link download', 'download link', 'where download', 'mana nak download'], ['s_inst', 's_smart']);
  n('s_inst', ['How do I install it?', 'Bagaimana memasang?'],
    ['<ol><li>Open the file from your browser\'s downloads (usually the <b>Downloads</b> folder).</li><li>Run it. It installs for your Windows user only, so <b>no administrator rights</b> are needed.</li><li>Rasumi Apps opens when it finishes.</li></ol>Already have an older version? Install over it. Your settings stay.',
     '<ol><li>Buka fail dari senarai muat turun browser (biasanya folder <b>Downloads</b>).</li><li>Jalankan. Ia dipasang untuk user Windows anda sahaja, jadi <b>tidak perlu hak administrator</b>.</li><li>Rasumi Apps terbuka sebaik selesai.</li></ol>Ada versi lama? Pasang terus di atasnya. Tetapan anda kekal.'],
    ['install', 'pasang', 'installation', 'admin', 'administrator', 'hak admin', 'older version', 'versi lama', 'upgrade', 'naik taraf'], ['s_smart', 's_signup']);
  n('s_smart', ['Windows says "Windows protected your PC"', 'Windows papar "Windows protected your PC"'],
    ['That is normal for internal software that is not sold in public stores. Click <b>More info</b>, then <b>Run anyway</b>. The installer is built and signed off by Rasumi IT.',
     'Itu biasa untuk perisian dalaman yang tidak dijual di kedai awam. Klik <b>More info</b>, kemudian <b>Run anyway</b>. Installer ini dibina dan disahkan oleh IT Rasumi.'],
    ['windows protected', 'smartscreen', 'protected your pc', 'run anyway', 'more info', 'virus', 'selamat ke', 'is it safe', 'antivirus', 'blocked', 'disekat'], ['s_inst']);
  n('s_signup', ['Which e-mail do I sign up with?', 'E-mel mana untuk daftar?'],
    [function (c) { return 'Use the e-mail this invitation was sent to' + (c.email ? ': <b>' + c.esc(c.email) + '</b>' : '') + '. Other e-mails cannot sign up.<ol><li>Open Rasumi Apps and press <b>Sign up</b>.</li><li>Enter this e-mail and choose a password, or tap <b>Google</b> or <b>Microsoft</b>.</li><li>Confirm the e-mail we send you (from noreply@rasumi.com.my).</li></ol>'; },
     function (c) { return 'Guna e-mel yang menerima jemputan ini' + (c.email ? ': <b>' + c.esc(c.email) + '</b>' : '') + '. E-mel lain tidak boleh mendaftar.<ol><li>Buka Rasumi Apps dan tekan <b>Sign up</b>.</li><li>Masukkan e-mel ini dan pilih password, atau tekan <b>Google</b> atau <b>Microsoft</b>.</li><li>Sahkan e-mel yang kami hantar (dari noreply@rasumi.com.my).</li></ol>'; }],
    ['sign up', 'signup', 'daftar', 'register', 'which email', 'e-mel mana', 'email mana', 'create account', 'cipta akaun', 'buat akaun'], ['s_2fa', 'a_google']);
  n('s_2fa', ['How do I turn on two-step verification?', 'Bagaimana aktifkan pengesahan dua langkah?'],
    ['After your first sign-in, Rasumi Apps shows a QR code. Scan it once with an authenticator app (<b>Google Authenticator</b> or <b>Microsoft Authenticator</b>), then type the 6-digit code. From then on, every sign-in asks for the current code from the app.',
     'Selepas log masuk pertama, Rasumi Apps papar kod QR. Imbas sekali dengan app authenticator (<b>Google Authenticator</b> atau <b>Microsoft Authenticator</b>), kemudian taip kod 6 digit. Selepas itu, setiap log masuk akan minta kod semasa dari app tersebut.'],
    ['2fa', 'two-step', 'two step', 'dua langkah', 'authenticator', 'otp', 'qr', 'kod 6', '6-digit', 'verification code', 'kod pengesahan'], ['a_lostphone']);
  n('s_link', ['My link expired or I changed PC', 'Link tamat tempoh atau saya tukar PC'],
    ['For your security the invitation works only on the PC and browser where you first downloaded, and only until its expiry date. If it expired or you changed PC, use <b>Leave a message for IT</b> and IT will reset it or send a new invitation.',
     'Untuk keselamatan, jemputan hanya berfungsi di PC dan browser tempat muat turun pertama, dan hanya sehingga tarikh tamat. Jika tamat tempoh atau anda tukar PC, guna <b>Tinggalkan mesej untuk IT</b> dan IT akan reset atau hantar jemputan baharu.'],
    ['expired', 'tamat', 'tamat tempoh', 'tukar pc', 'changed pc', 'new pc', 'pc baru', 'format pc', 'link not working', 'link tak jalan', 'not available', 'reset invitation', 'reset jemputan'], ['it']);
  n('s_req', ['What do I need? Can I use my phone?', 'Apa keperluan? Boleh guna telefon?'],
    ['Rasumi Apps runs on <b>Windows 10 or 11 PCs</b> with an internet connection. It does not run on phones, tablets or Mac. You can read this page on your phone, but download on your PC. Updates install by themselves the next time you open the app.',
     'Rasumi Apps berjalan di <b>PC Windows 10 atau 11</b> dengan sambungan internet. Ia tidak berjalan di telefon, tablet atau Mac. Anda boleh baca page ini di telefon, tetapi muat turun di PC. Kemas kini dipasang sendiri bila app dibuka.'],
    ['phone', 'telefon', 'handphone', 'mobile', 'mac', 'ipad', 'tablet', 'requirement', 'keperluan', 'windows 10', 'windows 11', 'windows 7', 'windows 8', 'spec', 'ram', '32 bit', '64 bit', 'macbook'], ['s_dl']);

  // ---------------------------------------------------------------- 2. the apps
  n('apps', ['The apps', 'Aplikasi'],
    ['Rasumi Apps puts the tools you use every day in one place. What you see depends on your role. Which one would you like to know about?',
     'Rasumi Apps himpunkan alat kerja harian dalam satu tempat. Apa yang anda nampak bergantung pada peranan anda. App mana yang anda mahu tahu?'],
    ['app', 'aplikasi', 'module', 'modul', 'feature', 'fungsi', 'what can', 'apa boleh'], ['p_dash', 'p_renamer', 'p_splitter', 'p_scanify', 'p_docmgr', 'p_store', 'p_portal', 'p_po', 'p_vibes', 'p_admin', 'p_exec', 'p_settings']);
  n('p_dash', ['Dashboard', 'Dashboard'],
    ['Your day at a glance the moment you sign in: today\'s totals for every app, the <b>notification bell</b> (deliveries, special requests, POs ready, even if they arrived while the app was closed), and Quick Rename / PDF Studio one click away.',
     'Ringkasan hari anda sebaik log masuk: jumlah hari ini untuk setiap app, <b>loceng notifikasi</b> (penghantaran, special request, PO siap, walaupun tiba semasa app ditutup), serta Quick Rename / PDF Studio dengan satu klik.'],
    ['dashboard', 'home', 'utama', 'notification', 'notifikasi', 'bell', 'loceng'], [], { agent: 'notifier' });
  n('p_renamer', ['PDF Renamer', 'PDF Renamer'],
    ['Reads each scanned invoice and DO and renames the file in the format your team files it, ready for DocuShare.<ul><li><b>HQ</b>: document number + ID, both pages checked; anything below 75% confidence is held for review instead of being renamed wrongly.</li><li><b>FV branch</b>: the DO number is read at 300 dpi and doubtful digits (1/7, 0/8) are read again before renaming.</li></ul>You see the file being read and the time left.',
     'Membaca setiap invois dan DO yang diimbas dan menamakan fail ikut format pasukan anda, sedia untuk DocuShare.<ul><li><b>HQ</b>: nombor dokumen + ID, kedua-dua page disemak; keyakinan bawah 75% ditahan untuk semakan, bukan dinamakan salah.</li><li><b>Cawangan FV</b>: nombor DO dibaca pada 300 dpi dan digit meragukan (1/7, 0/8) dibaca semula sebelum dinamakan.</li></ul>Anda nampak fail yang sedang dibaca dan baki masa.'],
    ['renamer', 'rename', 'namakan', 'nama fail', 'file name', 'docushare', 'ocr'], [], { agent: 'renamer' });
  n('p_splitter', ['PDF Splitter', 'PDF Splitter'],
    ['One long claim scan in, separate documents out. Each page is recognised (invoice, DO, prescription, IC, BQBP, service book and more), pages of the same document are kept together, and each part is saved as its own file.',
     'Satu scan claim panjang masuk, dokumen berasingan keluar. Setiap page dikenal pasti (invois, DO, preskripsi, IC, BQBP, buku servis dan lain-lain), page dokumen yang sama dikekalkan bersama, dan setiap bahagian disimpan sebagai fail sendiri.'],
    ['splitter', 'split', 'pecah', 'asingkan', 'bqbp', 'claim scan'], [], { agent: 'splitter' });
  n('p_scanify', ['Scanify', 'Scanify'],
    ['Turns phone photos of forms and ID cards into a clean PDF: drag the corners, rotate or auto-align, and put the IC front and back on one page. Branch counters use it to complete claim documents before they go to the HQ claim team.',
     'Menukar gambar telefon borang dan kad pengenalan kepada PDF yang kemas: tarik bucu, putar atau luruskan automatik, dan letak IC depan dan belakang pada satu page. Kaunter cawangan guna untuk lengkapkan dokumen claim sebelum dihantar ke pasukan claim HQ.'],
    ['scanify', 'scan', 'imbas', 'photo', 'gambar', 'ic', 'kad pengenalan', 'crop'], [], { agent: 'scanify' });
  n('p_docmgr', ['Doc Manager', 'Doc Manager'],
    ['Works with the VIMS claim list (New, Approved, Big batch, Sent, Completed): it gathers and checks the documents of each claim batch so the claim team can send complete claims.',
     'Bekerja dengan senarai claim VIMS (Baharu, Sah, Kumpulan Besar, Hantar, Completed): mengumpul dan menyemak dokumen setiap batch claim supaya pasukan claim boleh menghantar claim yang lengkap.'],
    ['doc manager', 'document manager', 'claim batch', 'batch claim', 'kumpulan besar'], [], { agent: 'vims_batch' });
  n('p_store', ['Store Management', 'Store Management'],
    ['Branch stock at a glance: stock in, stock out, transfers between branches, out-of-stock items, and fast and slow movers.',
     'Ringkasan stok cawangan: stok masuk, stok keluar, pindahan antara cawangan, item kehabisan stok, serta item laju dan perlahan.'],
    ['store management', 'stock', 'stok', 'inventory', 'inventori', 'transfer', 'pindahan', 'out of stock'], [], { agent: 'store_sync' });
  n('p_portal', ['Store Portal (pharmacists)', 'Store Portal (farmasi)'],
    ['The branch store system: products and bin card, receiving stock (AutoCount GRNs appear by themselves), transfers, delivery, stock count, and <b>Special Request</b>: pick the item and quantity, submit, and the purchaser turns it into a PO carrying your signature and stamp. Supplier invoices are ready for every delivered order.',
     'Sistem stor cawangan: produk dan bin card, terima stok (GRN AutoCount muncul sendiri), pindahan, penghantaran, stock count, dan <b>Special Request</b>: pilih item dan kuantiti, hantar, dan purchaser tukar menjadi PO dengan tandatangan dan cop anda. Invois pembekal tersedia untuk setiap order yang dihantar.'],
    ['store portal', 'portal', 'special request', 'bin card', 'stock count', 'receive', 'terima stok', 'pharmacist', 'farmasi', 'grn'], [], { agent: 'grn' });
  n('p_po', ['PO Mailer (purchasers)', 'PO Mailer (purchaser)'],
    ['From stock alert to purchase order: the Stock Alert suggests quantity and supplier for each item (from a nightly min/max plan), you create the PO in AutoCount in one click for FVKL, FVT, FVL, FVG or RSA, and it is e-mailed to the supplier. Delivery status and supplier invoices are tracked on the same screen.',
     'Dari stock alert ke purchase order: Stock Alert cadangkan kuantiti dan pembekal untuk setiap item (dari pelan min/max setiap malam), anda cipta PO dalam AutoCount dengan satu klik untuk FVKL, FVT, FVL, FVG atau RSA, dan ia dihantar ke pembekal melalui e-mel. Status penghantaran dan invois pembekal dijejak di skrin yang sama.'],
    ['po mailer', 'po', 'purchase order', 'pesanan', 'purchaser', 'supplier', 'pembekal', 'stock alert', 'reorder'], [], { agent: 'po' });
  n('p_vibes', ['Vibes Agent (claims)', 'Vibes Agent (claim)'],
    ['Uploads claim documents into the JHEV claim (tuntutan) on the Vibes portal, DO by DO, and records each upload so Accounts can see which DOs have been sent to JHEV.',
     'Memuat naik dokumen claim ke dalam tuntutan JHEV di portal Vibes, DO demi DO, dan merekod setiap muat naik supaya Akaun boleh lihat DO mana yang sudah dihantar ke JHEV.'],
    ['vibes', 'jhev', 'tuntutan', 'claim upload', 'portal jhev'], [], { agent: 'vibes' });
  n('p_admin', ['Admin Monitor', 'Admin Monitor'],
    ['For admins: machines running Rasumi Apps, activity logs, errors and their fixes, all in one place.',
     'Untuk admin: mesin yang menjalankan Rasumi Apps, log aktiviti, ralat dan pembaikannya, dalam satu tempat.'],
    ['admin monitor', 'monitor', 'logs', 'log', 'machines', 'mesin'], [], { agent: 'sentinel' });
  n('p_exec', ['Executive (BOD, HR, Accounts)', 'Eksekutif (BOD, HR, Akaun)'],
    ['For the Board, HR and Accounts: sales, medicine cost and margin, collections, purchases and what customers owe; the <b>JHEV claims</b> tracker (every DO month: issued, sent, paid, carried forward); branch operations; and staff workload and KPI measured against each branch\'s own normal. Reports export to PDF and Excel.',
     'Untuk Lembaga, HR dan Akaun: jualan, kos ubat dan margin, kutipan, belian dan baki pelanggan; penjejak <b>tuntutan JHEV</b> (setiap bulan DO: dikeluarkan, dihantar, dibayar, dibawa ke depan); operasi cawangan; serta beban kerja dan KPI staf berbanding normal cawangan sendiri. Laporan boleh dieksport ke PDF dan Excel.'],
    ['executive', 'eksekutif', 'bod', 'hr', 'accounts team', 'jabatan akaun', 'kpi', 'report', 'laporan', 'finance', 'kewangan', 'jhev claims'], [], { agent: 'workload' });
  n('p_settings', ['Settings', 'Settings'],
    ['Your account, your way: sign-in methods (password, Google, Microsoft), two-step verification, light / dark / auto theme, and signing out other devices.',
     'Akaun anda, cara anda: kaedah log masuk (password, Google, Microsoft), pengesahan dua langkah, tema cerah / gelap / auto, dan log keluar peranti lain.'],
    ['settings', 'tetapan', 'theme', 'tema', 'dark mode', 'profile', 'profil', 'devices', 'peranti'], []);

  // ---------------------------------------------------------------- 3. the 20 agents (real processes)
  var AG = [
    ['vims_sync', 'VIMS Sync', 'Pulls sales, DOs and indents from VIMS every 10 minutes (7:30 am–10 pm) with a full check at 4:40 pm, detects public holidays and fills in up to 12 months of history.', 'Menarik jualan, DO dan indent dari VIMS setiap 10 minit (7:30 pagi–10 malam) dengan semakan penuh 4:40 petang, mengenal pasti cuti umum dan mengisi sejarah sehingga 12 bulan.'],
    ['vims_batch', 'VIMS Claim Batch', 'Reads the VIMS claim list (New → Completed): who batched each claim and which DOs are in it.', 'Membaca senarai claim VIMS (Baharu → Completed): siapa yang batch setiap claim dan DO apa di dalamnya.'],
    ['ac_bridge', 'AutoCount Bridge', 'Keeps every AutoCount book in sync: invoices, DOs, POs, GRNs, payments, customer ageing and the audit trail.', 'Menyelaraskan semua buku AutoCount: invois, DO, PO, GRN, bayaran, umur hutang pelanggan dan audit trail.'],
    ['vibes', 'Vibes Agent', 'Uploads claim documents into JHEV claims on the Vibes portal and records each DO it sends.', 'Memuat naik dokumen claim ke tuntutan JHEV di portal Vibes dan merekod setiap DO yang dihantar.'],
    ['store_sync', 'Store Sync', 'Keeps Store Portal stock, transfers, bin card and stock counts in step across branches.', 'Menyelaraskan stok, pindahan, bin card dan stock count Store Portal antara cawangan.'],
    ['finance', 'Finance Snapshot', 'Every 10 minutes: sales, medicine cost, collections, supplier payments, JHEV billed and paid, and ageing per branch.', 'Setiap 10 minit: jualan, kos ubat, kutipan, bayaran pembekal, JHEV dibil dan dibayar, serta umur hutang setiap cawangan.'],
    ['workload', 'Workload & KPI', 'Builds each staff member\'s daily work from VIMS, AutoCount, Rasumi Apps and Store Portal, links names to staff IDs, and works out monthly station and KPI.', 'Membina kerja harian setiap staf dari VIMS, AutoCount, Rasumi Apps dan Store Portal, memadankan nama dengan ID staf, dan mengira stesen serta KPI bulanan.'],
    ['claims', 'JHEV Claim Tracker', 'Every 10 minutes: each DO from issued → sent to JHEV → paid, with balances carried to the next month until done.', 'Setiap 10 minit: setiap DO dari dikeluarkan → dihantar ke JHEV → dibayar, dengan baki dibawa ke bulan seterusnya sehingga selesai.'],
    ['reports', 'Report Builder', 'Builds the Executive reports (PDF and Excel) when someone presses Generate report.', 'Menjana laporan Eksekutif (PDF dan Excel) bila Jana laporan ditekan.'],
    ['reorder', 'Reorder Planner', 'Every night: a suggested minimum and maximum stock for every item, used by the Stock Alert.', 'Setiap malam: cadangan stok minimum dan maksimum untuk setiap item, digunakan oleh Stock Alert.'],
    ['po', 'PO Agent', 'Turns stock alerts and special requests into AutoCount POs and e-mails them to suppliers.', 'Menukar stock alert dan special request kepada PO AutoCount dan menghantarnya kepada pembekal melalui e-mel.'],
    ['supplier', 'Supplier Portal', 'Downloads supplier invoices and checks delivery status on supplier portals.', 'Memuat turun invois pembekal dan menyemak status penghantaran di portal pembekal.'],
    ['docushare', 'DocuShare Uploader', 'Uploads supplier invoices to the right DocuShare folder when an order is delivered.', 'Memuat naik invois pembekal ke folder DocuShare yang betul bila order dihantar.'],
    ['grn', 'GRN Auto-receive', 'Puts AutoCount GRNs onto the Store Portal bin card by themselves.', 'Memasukkan GRN AutoCount ke bin card Store Portal secara automatik.'],
    ['renamer', 'Renamer', 'Reads and renames invoices and DOs in HQ and FV branch formats, re-checking doubtful digits.', 'Membaca dan menamakan invois dan DO dalam format HQ dan cawangan FV, menyemak semula digit meragukan.'],
    ['splitter', 'Splitter', 'Splits claim scans into separate documents by type.', 'Memecahkan scan claim kepada dokumen berasingan ikut jenis.'],
    ['scanify', 'Scanify', 'Straightens document photos and puts the IC front and back on one page.', 'Meluruskan gambar dokumen dan meletakkan IC depan dan belakang pada satu page.'],
    ['notifier', 'Notifier', 'The notification bell plus every noreply e-mail: invitations, 2FA codes, password resets and IT tickets.', 'Loceng notifikasi serta semua e-mel noreply: jemputan, kod 2FA, reset password dan tiket IT.'],
    ['sentinel', 'Sentinel', 'Watches security events and suspicious sign-in attempts on its own server.', 'Memantau peristiwa keselamatan dan cubaan log masuk mencurigakan di servernya sendiri.'],
    ['support', 'Support Desk', 'Takes "Leave a message for IT" from this chat, sends it to IT and keeps the ratings.', 'Menerima "Tinggalkan mesej untuk IT" dari chat ini, menghantar kepada IT dan menyimpan rating.']
  ];
  n('agents', ['The 20 AI agents', '20 AI agent'],
    ['Ah, the agents! Yes, Rasumi Apps has <b>20 of them</b> working quietly in the background, day and night. No dummies: each one has a real job, from pulling VIMS and AutoCount data to sending POs and tracking JHEV claims. Which group do you want to peek at?',
     'Ah, agent-agent tu! Ya, Rasumi Apps ada <b>20 agent</b> yang bekerja senyap-senyap di belakang tabir, siang dan malam. Bukan hiasan: setiap satu ada kerja sebenar, dari tarik data VIMS dan AutoCount hingga hantar PO dan jejak tuntutan JHEV. Kumpulan mana yang anda nak tengok?'],
    ['agent', 'agents', 'ai', 'bot', 'automation', 'automasi', 'robot', '20 agent'], ['g_data', 'g_exec', 'g_buy', 'g_docs', 'g_sys', 'g_all']);
  function grp(id, en, ms, keys, kw) {
    n(id, [en, ms], [function (c) { return c.agentList(keys, 'en'); }, function (c) { return c.agentList(keys, 'ms'); }], kw, [], { live: true });
  }
  grp('g_data', 'Who pulls the data (VIMS, AutoCount, Vibes)?', 'Siapa tarik data (VIMS, AutoCount, Vibes)?', ['vims_sync', 'vims_batch', 'ac_bridge', 'vibes', 'store_sync'], ['pull data', 'tarik data', 'sync', 'vims', 'autocount', 'ac', 'data source', 'sumber data', 'vibes', 'jhev', 'upload to jhev', 'claim upload', 'store sync']);
  grp('g_exec', 'Who builds the Executive reports and KPI?', 'Siapa bina laporan Eksekutif dan KPI?', ['finance', 'workload', 'claims', 'reports'], ['who builds report', 'siapa buat laporan', 'siapa siapkan report', 'report agent', 'kpi agent', 'claim tracker', 'report', 'laporan', 'kpi', 'executive', 'eksekutif', 'finance', 'kewangan']);
  grp('g_buy', 'Purchasing and store agents', 'Agent purchasing dan stor', ['reorder', 'po', 'supplier', 'docushare', 'grn'], ['purchasing agent', 'po agent', 'grn agent', 'supplier agent', 'docushare agent', 'purchase order', 'reorder', 'grn', 'docushare', 'supplier', 'pembekal', 'invoice', 'invois']);
  grp('g_docs', 'Document agents', 'Agent dokumen', ['renamer', 'splitter', 'scanify'], ['document agent', 'agent dokumen', 'ocr agent', 'renamer', 'splitter', 'scanify', 'rename', 'ocr']);
  grp('g_sys', 'System and security agents', 'Agent sistem dan keselamatan', ['notifier', 'sentinel', 'support'], ['security agent', 'sentinel', 'notifier', 'support desk', 'notification', 'notifikasi', 'email', 'e-mel', 'security', 'keselamatan']);
  grp('g_all', 'Show all 20 agents', 'Tunjuk semua 20 agent', AG.map(function (x) { return x[0]; }), ['all agents', 'semua agent', 'list agent', 'senarai agent', '20 agents']);

  // ---------------------------------------------------------------- 4. account & security
  n('account', ['Account & security', 'Akaun & keselamatan'],
    ['Your account is personal and protected. What would you like to know?', 'Akaun anda peribadi dan dilindungi. Apa yang anda mahu tahu?'],
    ['account', 'akaun', 'security', 'keselamatan', 'login', 'log masuk', 'sign in'], ['a_personal', 'a_forgot', 'a_lostphone', 'a_google', 'a_logout', 'a_devices', 'a_privacy']);
  n('a_logout', ['How do I sign out?', 'Bagaimana log keluar?'],
    ['Press <b>Log Out</b> in the profile menu (top right). Closing the window with <b>X</b> keeps you signed in for the day, which is fine on your own PC; on a shared PC always use Log Out.',
     'Tekan <b>Log Out</b> dalam menu profil (atas kanan). Tutup tetingkap dengan <b>X</b> mengekalkan log masuk untuk hari itu, tidak mengapa di PC sendiri; di PC kongsi sentiasa guna Log Out.'],
    ['sign out', 'log keluar', 'logout', 'log out', 'keluar akaun', 'stay signed in', 'kekal log masuk'], []);
  n('a_personal', ['Why a personal account?', 'Kenapa akaun peribadi?'],
    ['Every action you take is recorded under your own name, so your work is credited to you (for example in the staff workload and KPI) and nobody can act as you. On a shared PC, press <b>Log Out</b> when you finish; closing with <b>X</b> keeps you signed in for the day.',
     'Setiap tindakan direkod atas nama anda sendiri, jadi kerja anda dikreditkan kepada anda (contohnya dalam beban kerja dan KPI staf) dan tiada orang boleh bertindak sebagai anda. Di PC kongsi, tekan <b>Log Out</b> bila selesai; tutup dengan <b>X</b> mengekalkan log masuk untuk hari itu.'],
    ['personal', 'peribadi', 'shared pc', 'pc kongsi', 'single id', 'id sendiri', 'own account', 'akaun sendiri', 'share account', 'kongsi akaun', 'guna id orang'], []);
  n('a_forgot', ['I forgot my password', 'Saya lupa password'],
    ['On the sign-in screen press <b>Forgot password</b>. We e-mail a reset link from noreply@rasumi.com.my. Open it, choose a new password and, if two-step is on, type the 6-digit code from your authenticator app.',
     'Di skrin log masuk tekan <b>Forgot password</b>. Kami e-mel link reset dari noreply@rasumi.com.my. Buka, pilih password baharu dan, jika dua langkah aktif, taip kod 6 digit dari app authenticator.'],
    ['forgot', 'lupa', 'reset password', 'password', 'kata laluan', 'tukar password', 'change password'], ['a_lostphone']);
  n('a_lostphone', ['I lost my phone / authenticator', 'Saya hilang telefon / authenticator'],
    ['No problem. IT can reset your two-step verification. Use <b>Leave a message for IT</b> from your invited e-mail; after the reset you set up the authenticator again on your next sign-in.',
     'Tiada masalah. IT boleh reset pengesahan dua langkah anda. Guna <b>Tinggalkan mesej untuk IT</b> dari e-mel jemputan; selepas reset anda set semula authenticator pada log masuk seterusnya.'],
    ['lost phone', 'lost my phone', 'phone lost', 'hilang telefon', 'telefon hilang', 'new phone', 'telefon baru', 'reset 2fa', 'authenticator hilang', 'got new phone', 'change phone', 'changed phone', 'tukar telefon', 'ganti telefon', 'phone rosak', 'telefon rosak'], ['it']);
  n('a_google', ['Can I sign in with Google or Microsoft?', 'Boleh log masuk dengan Google atau Microsoft?'],
    ['Yes. Tap the <b>Google</b> or <b>Microsoft</b> icon on the sign-in screen, as long as the account uses your invited e-mail. You can add or remove sign-in methods later in <b>Settings</b>.',
     'Boleh. Tekan ikon <b>Google</b> atau <b>Microsoft</b> di skrin log masuk, asalkan akaun itu guna e-mel jemputan anda. Anda boleh tambah atau buang kaedah log masuk dalam <b>Settings</b>.'],
    ['google', 'microsoft', 'gmail', 'outlook', 'sso', 'oauth'], []);
  n('a_devices', ['Sign out other devices / change e-mail', 'Log keluar peranti lain / tukar e-mel'],
    ['<b>Settings → My Profile</b> lists your signed-in devices; you can sign out the others there. To change your sign-in e-mail, ask IT; the change is confirmed through both addresses.',
     '<b>Settings → My Profile</b> senaraikan peranti yang log masuk; anda boleh log keluar yang lain di situ. Untuk tukar e-mel log masuk, minta IT; perubahan disahkan melalui kedua-dua alamat.'],
    ['devices', 'peranti', 'sign out other', 'change email', 'tukar email', 'tukar e-mel'], []);
  n('a_privacy', ['Where does my data go?', 'Ke mana data saya pergi?'],
    ['Your account and work data stay inside Rasumi systems. Sign-in uses encrypted connections (HTTPS), passwords are never stored in plain text, invitation links are stored only as hashes and locked to your PC, and patient details from VIMS are never copied into reports.',
     'Akaun dan data kerja anda kekal dalam sistem Rasumi. Log masuk guna sambungan disulitkan (HTTPS), password tidak pernah disimpan dalam teks biasa, link jemputan disimpan sebagai hash sahaja dan dikunci pada PC anda, dan butiran pesakit dari VIMS tidak pernah disalin ke laporan.'],
    ['privacy', 'privasi', 'data stored', 'where data', 'mana data', 'data disimpan', 'simpan data', 'my data', 'data saya', 'data', 'encrypt', 'patient', 'pesakit', 'pdpa'], []);

  // ---------------------------------------------------------------- 5. troubleshooting
  n('trouble', ['Something is not working', 'Ada masalah'],
    ['Sorry to hear that. Which one is closest to what you see?', 'Maaf mendengarnya. Yang mana paling hampir dengan apa yang anda alami?'],
    ['problem', 'masalah', 'not working', 'tak jalan', 'issue', 'isu', 'trouble', 'rosak', 'broken', 'something wrong', 'ada masalah'], ['x_dlfail', 'x_open', 'x_signin', 'x_email', 'x_code', 'x_slow', 'x_error', 'x_uninstall']);
  n('x_dlfail', ['The download fails or stops', 'Muat turun gagal atau terhenti'],
    ['<ol><li>Press <b>Download for Windows</b> again: each press gives a fresh link (old links stop after 10 minutes).</li><li>Use the <b>same browser</b> on the same PC you opened the invitation with.</li><li>If the browser or antivirus removed the file, choose <b>Keep</b> in the browser\'s downloads list.</li></ol>If it says the download limit is reached, leave a message for IT to reset it.',
     '<ol><li>Tekan <b>Download for Windows</b> semula: setiap tekanan beri link baharu (link lama tamat selepas 10 minit).</li><li>Guna <b>browser yang sama</b> di PC yang sama semasa anda buka jemputan.</li><li>Jika browser atau antivirus buang fail, pilih <b>Keep</b> dalam senarai muat turun browser.</li></ol>Jika tertera had muat turun dicapai, tinggalkan mesej untuk IT untuk reset.'],
    ['download fail', 'download failed', 'cannot download', 'can\'t download', 'tak boleh download', 'tak dapat download', 'gagal download', 'muat turun gagal', 'download stuck', 'download stop', 'terhenti', 'network error', 'failed download', 'download limit', 'had muat turun', 'download tak jadi', 'keep file', 'file deleted', 'fail hilang'], ['s_smart', 'it']);
  n('x_open', ['The app does not open or shows a blank screen', 'App tidak terbuka atau skrin kosong'],
    ['<ol><li>Wait a few seconds: the first start after install or update takes a little longer.</li><li>Close it fully (also from the icons next to the clock), then open <b>Rasumi Apps</b> again from the Start menu.</li><li>Restart the PC.</li><li>Still blank? Run the installer again over the top: your settings stay.</li></ol>If none of this works, leave a message for IT with a photo of the screen.',
     '<ol><li>Tunggu beberapa saat: permulaan pertama selepas pasang atau kemas kini ambil masa sedikit.</li><li>Tutup sepenuhnya (juga dari ikon sebelah jam), kemudian buka <b>Rasumi Apps</b> semula dari menu Start.</li><li>Restart PC.</li><li>Masih kosong? Jalankan installer sekali lagi di atasnya: tetapan anda kekal.</li></ol>Jika masih gagal, tinggalkan mesej untuk IT dengan gambar skrin.'],
    ['not open', 'tak buka', 'tidak terbuka', 'won\'t open', 'cannot open', 'tak boleh buka', 'blank', 'kosong', 'white screen', 'skrin putih', 'black screen', 'skrin hitam', 'crash', 'hang', 'freeze', 'tergantung', 'close sendiri', 'closes by itself'], ['it']);
  n('x_signin', ['I cannot sign in', 'Saya tidak boleh log masuk'],
    [function (c) { return '<ul><li>Use the invited e-mail' + (c.email ? ' (<b>' + c.esc(c.email) + '</b>)' : '') + '; other e-mails are not allowed.</li><li>New account? Open the confirmation e-mail from noreply@rasumi.com.my first.</li><li>Wrong password? Press <b>Forgot password</b>.</li><li>Too many tries? Wait a few minutes before trying again.</li><li>With Google or Microsoft, pick the account with the invited e-mail.</li></ul>'; },
     function (c) { return '<ul><li>Guna e-mel jemputan' + (c.email ? ' (<b>' + c.esc(c.email) + '</b>)' : '') + '; e-mel lain tidak dibenarkan.</li><li>Akaun baharu? Buka e-mel pengesahan dari noreply@rasumi.com.my dahulu.</li><li>Password salah? Tekan <b>Forgot password</b>.</li><li>Terlalu banyak cubaan? Tunggu beberapa minit sebelum cuba semula.</li><li>Dengan Google atau Microsoft, pilih akaun yang guna e-mel jemputan.</li></ul>'; }],
    ['cannot sign in', 'can\'t sign in', 'cannot login', 'can\'t login', 'tak boleh login', 'tak boleh log masuk', 'login failed', 'gagal log masuk', 'wrong password', 'password salah', 'invalid', 'locked', 'dikunci', 'access denied', 'not allowed', 'tidak dibenarkan', 'account disabled'], ['a_forgot', 'x_email', 'x_code']);
  n('x_email', ['I did not get the e-mail', 'Saya tidak terima e-mel'],
    ['Our e-mails come from <b>noreply@rasumi.com.my</b>.<ol><li>Wait 2–3 minutes.</li><li>Check <b>Spam</b> or <b>Junk</b>, and in Gmail the <b>Promotions</b> or <b>Updates</b> tab.</li><li>Make sure you typed the invited e-mail.</li><li>Ask for it again (for example press Forgot password again).</li></ol>Still nothing after 10 minutes? Leave a message for IT.',
     'E-mel kami dari <b>noreply@rasumi.com.my</b>.<ol><li>Tunggu 2–3 minit.</li><li>Semak <b>Spam</b> atau <b>Junk</b>, dan dalam Gmail tab <b>Promotions</b> atau <b>Updates</b>.</li><li>Pastikan anda taip e-mel jemputan.</li><li>Minta semula (contohnya tekan Forgot password sekali lagi).</li></ol>Masih tiada selepas 10 minit? Tinggalkan mesej untuk IT.'],
    ['no email', 'tak dapat email', 'tak terima email', 'tiada email', 'tak dapat e mel', 'did not get', 'didn\'t get', 'didn\'t receive', 'not received', 'tak sampai', 'spam', 'junk', 'confirmation email', 'e mel pengesahan', 'verify email', 'sahkan email'], ['it']);
  n('x_code', ['The 6-digit code is not accepted', 'Kod 6 digit tidak diterima'],
    ['<ol><li>Type the <b>newest</b> code; each one changes every 30 seconds.</li><li>Make sure the phone\'s date and time are set to <b>automatic</b>; a clock that is a minute off makes codes fail.</li><li>Use the Rasumi entry in the authenticator app, not another account.</li></ol>Changed or lost your phone? Leave a message for IT to reset two-step.',
     '<ol><li>Taip kod <b>terbaru</b>; setiap kod bertukar setiap 30 saat.</li><li>Pastikan tarikh dan masa telefon ditetapkan <b>automatik</b>; jam yang lari seminit menyebabkan kod gagal.</li><li>Guna entri Rasumi dalam app authenticator, bukan akaun lain.</li></ol>Tukar atau hilang telefon? Tinggalkan mesej untuk IT untuk reset dua langkah.'],
    ['otp not working', 'code not working', 'kod tak jalan', 'kod tak boleh', 'code wrong', 'kod salah', 'tak dapat kod', 'cannot get code', 'no code', 'tiada kod', 'code not accepted', 'kod tak diterima', 'invalid code', 'kod tidak sah', 'otp salah', 'otp tak jalan', 'code expired', 'kod tamat', 'authenticator not working', 'authenticator tak jalan'], ['a_lostphone']);
  n('x_slow', ['It is slow or numbers look old', 'Lambat atau angka nampak lama'],
    ['Rasumi Apps needs a working internet connection. Data from VIMS and AutoCount refreshes every few minutes, so very new entries can take up to about 10 minutes to appear. If a screen seems stuck, close and reopen the app; if it stays slow for everyone at the branch, tell IT.',
     'Rasumi Apps perlukan sambungan internet. Data dari VIMS dan AutoCount dikemas kini setiap beberapa minit, jadi entri sangat baharu boleh ambil sehingga lebih kurang 10 minit untuk muncul. Jika skrin nampak tersekat, tutup dan buka semula app; jika kekal lambat untuk semua di cawangan, beritahu IT.'],
    ['slow', 'lambat', 'lag', 'loading', 'lama sangat', 'takes long', 'old data', 'data lama', 'not updated', 'tak update', 'tak terkini', 'offline', 'internet', 'wifi', 'no connection', 'tiada sambungan'], ['it']);
  n('x_error', ['I see an error message', 'Saya nampak mesej ralat'],
    ['Take a screenshot (<b>Windows + Shift + S</b>) or a photo, then use <b>Leave a message for IT</b> and type what you were doing and the error text. Most errors are also logged automatically, so IT can find them quickly.',
     'Ambil screenshot (<b>Windows + Shift + S</b>) atau gambar, kemudian guna <b>Tinggalkan mesej untuk IT</b> dan taip apa yang anda sedang buat serta teks ralat. Kebanyakan ralat juga direkod secara automatik, jadi IT boleh cari dengan cepat.'],
    ['install error', 'error install', 'ralat pasang', 'error pasang', 'error masa', 'report bug', 'lapor bug', 'report error', 'report issue', 'lapor masalah', 'error', 'ralat', 'eror', 'err', 'failed', 'gagal', 'exception', 'something went wrong', 'popup', 'warning', 'amaran', 'bug'], ['it']);
  n('x_uninstall', ['How do I uninstall it?', 'Bagaimana nyahpasang?'],
    ['Open Windows <b>Settings → Apps → Installed apps</b>, find <b>Rasumi Apps</b> and choose <b>Uninstall</b>. No administrator rights are needed. To reinstall later you need a new invitation from IT.',
     'Buka <b>Settings → Apps → Installed apps</b> Windows, cari <b>Rasumi Apps</b> dan pilih <b>Uninstall</b>. Tidak perlu hak administrator. Untuk pasang semula nanti anda perlukan jemputan baharu dari IT.'],
    ['uninstall', 'nyahpasang', 'buang app', 'remove app', 'delete app', 'padam app', 'reinstall', 'pasang semula'], []);

  // ---------------------------------------------------------------- 6. technology
  n('tech', ['Technology', 'Teknologi'],
    ['Happy to talk tech. What would you like to know?', 'Boleh, mari bincang teknologi. Apa yang anda mahu tahu?'],
    ['technology', 'teknologi', 'tech', 'stack', 'built with', 'dibina dengan'], ['t_lang', 't_db', 't_ai', 't_host', 't_update', 't_sec']);
  n('t_lang', ['Which languages and engine?', 'Bahasa dan engine apa?'],
    ['<ul><li><b>Desktop app</b>: Python with an HTML, CSS and JavaScript interface running in Microsoft Edge WebView2.</li><li><b>Vibes Agent</b>: Rust.</li><li><b>AutoCount bridge</b>: C# on .NET with the AutoCount SDK.</li><li><b>Server functions</b>: TypeScript on Deno; database logic in PostgreSQL (SQL / PL/pgSQL).</li><li><b>Sentinel</b>: Python FastAPI on Debian.</li><li>Scripts in PowerShell and Bash; packaged with PyInstaller and Inno Setup.</li></ul>',
     '<ul><li><b>App desktop</b>: Python dengan antara muka HTML, CSS dan JavaScript dalam Microsoft Edge WebView2.</li><li><b>Vibes Agent</b>: Rust.</li><li><b>Bridge AutoCount</b>: C# di .NET dengan AutoCount SDK.</li><li><b>Fungsi server</b>: TypeScript di Deno; logik database dalam PostgreSQL (SQL / PL/pgSQL).</li><li><b>Sentinel</b>: Python FastAPI di Debian.</li><li>Skrip PowerShell dan Bash; dibungkus dengan PyInstaller dan Inno Setup.</li></ul>'],
    ['language', 'bahasa', 'engine', 'python', 'javascript', 'rust', 'c#', 'csharp', '.net', 'typescript', 'framework', 'coding', 'programming', 'webview'], []);
  n('t_db', ['Which database?', 'Database apa?'],
    ['<b>PostgreSQL</b> on Supabase (with its authentication, storage and edge functions). AutoCount runs on <b>Microsoft SQL Server</b> at the office and is synced by the AutoCount Bridge; the desktop app keeps small local caches in SQLite.',
     '<b>PostgreSQL</b> di Supabase (bersama authentication, storage dan edge functions). AutoCount berjalan di <b>Microsoft SQL Server</b> di pejabat dan diselaraskan oleh AutoCount Bridge; app desktop simpan cache kecil dalam SQLite.'],
    ['database', 'db', 'postgres', 'postgresql', 'supabase', 'sql server', 'sqlite', 'mssql'], []);
  n('t_ai', ['How does it read documents (AI / OCR)?', 'Bagaimana ia membaca dokumen (AI / OCR)?'],
    ['Digital text is read directly from the PDF. Scans go through OCR (Google OCR) after image clean-up with OpenCV and Pillow: deskew, sharpen and, for doubtful digits, a second read with a sharper or eroded image. Results are checked against rules (both pages agree, number formats, confidence ≥ 75%) before a file is renamed or split.',
     'Teks digital dibaca terus dari PDF. Scan melalui OCR (Google OCR) selepas imej dibersihkan dengan OpenCV dan Pillow: luruskan, tajamkan dan, untuk digit meragukan, bacaan kedua dengan imej lebih tajam. Hasil disemak ikut peraturan (kedua-dua page sepadan, format nombor, keyakinan ≥ 75%) sebelum fail dinamakan atau dipecahkan.'],
    ['ai', 'ocr', 'read document', 'baca dokumen', 'machine learning', 'opencv', 'how does it read', 'bagaimana baca'], []);
  n('t_host', ['Where is it hosted?', 'Dihoskan di mana?'],
    ['The database and server functions run on <b>Supabase</b>; web pages such as this one on <b>Cloudflare</b>; the AutoCount Bridge on the office server; Sentinel on its own Debian server; and VIMS / supplier portals are reached with Selenium and ChromeDriver.',
     'Database dan fungsi server berjalan di <b>Supabase</b>; page web seperti ini di <b>Cloudflare</b>; AutoCount Bridge di server pejabat; Sentinel di server Debian sendiri; dan portal VIMS / pembekal dicapai dengan Selenium dan ChromeDriver.'],
    ['host', 'hosting', 'server', 'cloud', 'cloudflare', 'where hosted', 'selenium', 'vps'], []);
  n('t_update', ['How do updates work?', 'Bagaimana kemas kini berfungsi?'],
    ['Rasumi Apps checks for a newer version when it opens and updates itself. There is nothing to download again and your settings stay.',
     'Rasumi Apps menyemak versi baharu bila dibuka dan mengemas kini dirinya. Tiada apa perlu dimuat turun semula dan tetapan anda kekal.'],
    ['update', 'kemas kini', 'new version', 'versi baru', 'auto update', 'upgrade'], []);
  n('t_sec', ['How is it secured?', 'Bagaimana keselamatannya?'],
    ['Personal accounts with two-step verification; row-level security and short-lived sessions on the database; invitation links locked to one PC and stored only as hashes; installers served from a private bucket with 10-minute links; Sentinel watching for suspicious sign-ins; and every action logged under the person who did it.',
     'Akaun peribadi dengan pengesahan dua langkah; row-level security dan sesi jangka pendek pada database; link jemputan dikunci pada satu PC dan disimpan sebagai hash; installer dari bucket peribadi dengan link 10 minit; Sentinel memantau log masuk mencurigakan; dan setiap tindakan direkod atas nama orang yang membuatnya.'],
    ['secure', 'security', 'keselamatan', 'hack', 'encryption', 'rls', 'safe'], []);

  // ---------------------------------------------------------------- 6. contact IT
  n('it', ['Contact IT', 'Hubungi IT'],
    ['I can pass your question to IT. Leave a message here and IT will reply to your e-mail as soon as possible. You can also e-mail <a href="mailto:it@rasumi.com.my">it@rasumi.com.my</a>.',
     'Saya boleh hantar soalan anda kepada IT. Tinggalkan mesej di sini dan IT akan membalas ke e-mel anda secepat mungkin. Anda juga boleh e-mel <a href="mailto:it@rasumi.com.my">it@rasumi.com.my</a>.'],
    ['contact', 'hubungi', 'it support', 'human', 'manusia', 'staff it', 'talk to', 'cakap dengan', 'leave message', 'tinggal mesej', 'report problem', 'lapor masalah', 'it team', 'pasukan it', 'live agent', 'real person', 'orang sebenar'], [], { form: true });
  n('it_when', ['When will IT reply?', 'Bila IT akan balas?'],
    ['IT replies by e-mail as soon as possible during office hours. Your message has a reference number (RA-…) and a copy goes to your inbox; reply to that e-mail to add details.',
     'IT membalas melalui e-mel secepat mungkin pada waktu pejabat. Mesej anda ada nombor rujukan (RA-…) dan salinan dihantar ke inbox anda; balas e-mel itu untuk tambah butiran.'],
    ['reply', 'balas', 'balasan', 'when reply', 'bila balas', 'how long reply', 'berapa lama balas', 'office hours', 'waktu pejabat', 'ticket status', 'status tiket', 'no reply', 'tiada balasan', 'reference', 'rujukan'], ['it']);

  // ---------------------------------------------------------------- small talk (typed)
  var SMALL = [
    { kw: ['hi', 'hello', 'hey', 'helo', 'hai', 'assalamualaikum', 'salam', 'good morning', 'selamat pagi', 'selamat petang'],
      a: ['Hello! How can I help with Rasumi Apps today?', 'Hai! Apa yang boleh saya bantu tentang Rasumi Apps hari ini?'] },
    { kw: ['thank', 'thanks', 'terima kasih', 'tq', 'thx'], a: ['You\'re welcome! Anything else about Rasumi Apps?', 'Sama-sama! Ada apa-apa lagi tentang Rasumi Apps?'] },
    { kw: ['who are you', 'siapa kamu', 'siapa awak', 'are you human', 'kau siapa', 'are you a bot'],
      a: ['I\'m Rasumi Agent, the assistant for Rasumi Apps. I answer questions about Rasumi Apps, from installing and signing in to using each app, and I can pass your message to IT.',
          'Saya Rasumi Agent, pembantu Rasumi Apps. Saya jawab soalan tentang Rasumi Apps, dari pemasangan dan log masuk hingga penggunaan setiap app, dan boleh hantar mesej anda kepada IT.'] },
    { kw: ['ok', 'okay', 'baik', 'noted', 'faham', 'understood', 'got it', 'alright', 'great', 'bagus', 'nice', 'cool'],
      a: ['Great! Anything else about Rasumi Apps?', 'Baik! Ada apa-apa lagi tentang Rasumi Apps?'] },
    { kw: ['tak faham', 'tidak faham', 'do not understand', 'confused', 'keliru', 'blur', 'not clear', 'kurang jelas'],
      a: ['No problem, let\'s take it step by step. Pick a topic below, or tell me in a few words what you are trying to do (for example "install", "forgot password" or "app will not open").',
          'Tiada masalah, kita buat satu-satu. Pilih topik di bawah, atau beritahu saya dalam beberapa perkataan apa yang anda cuba buat (contohnya "pasang", "lupa password" atau "app tak buka").'] },
    { kw: ['bye', 'goodbye', 'jumpa lagi', 'selamat tinggal', 'see you'],
      a: ['Goodbye! I\'m here whenever you need help with Rasumi Apps.', 'Jumpa lagi! Saya sentiasa ada bila anda perlukan bantuan tentang Rasumi Apps.'] }
  ];
  // high-precision phrasings checked before keyword scoring (text is lower case, punctuation removed)
  var INTENTS = [
    [/\b(what|wht|wat)( s| is| are)? (this |the )?rasumi( apps?)?\b|\bapa (itu |tu |ni |ini |benda )?rasumi( apps?)?\b|\brasumi( apps?)? (ni |tu |ialah |itu |ini )?apa\b|\b(tell|explain)( me)? (about |what )?(is )?rasumi\b|\bwhat (does|do|can) rasumi( apps?)? do\b|\brasumi( apps?)? (buat|boleh buat) apa\b/, 'about'],
    [/\b(what|apa) (is|itu|tu)? ?(vims)\b|\bvims (tu |ni |itu |ini )?apa\b/, 'w_vims'],
    [/\b(what|apa) (is|itu|tu)? ?(autocount)\b|\bautocount (tu |ni |itu |ini )?apa\b/, 'w_ac'],
    [/\b(what|apa) (is|itu|tu)? ?(docushare)\b|\bdocushare (tu |ni |itu |ini )?apa\b/, 'w_ds'],
    [/\b(what|apa) (is|itu|tu)? ?(jhev|vibes portal)\b|\bjhev (tu |ni |itu |ini )?apa\b/, 'w_jhev'],
    [/\b(how many|berapa) (agents?|ejen|bot)\b|\b(list|senarai|show|tunjuk)( all| semua)? (the )?(agents?|ejen)\b/, 'g_all'],
    [/\b(what|apa) (is |are |itu |tu )?(a |an )?(grn|do|po|dos|pos|delivery order|purchase order)\b|\b(grn|do|po) (tu |ni |itu |ini )?apa\b/, 'w_doc'],
    [/\b(which|what) apps?\b.*\b(see|get|have|use|access)\b|\bapps? (apa|mana)( yang)? (saya |aku )?(dapat|nampak|boleh guna|ada|guna)\b|\b(cant|can't|cannot|can not|tak|tidak) (see|nampak|jumpa|find) .*\b(app|apps|menu|module|modul|tab|po mailer|store portal|executive|eksekutif|scanify|renamer|splitter|vibes|admin monitor|doc manager)\b/, 'b_role'],
    [/^(?!.*(virus|smartscreen|protected|installer|blocked|disekat|selamat (pagi|petang|malam|tinggal|datang|tengahari))).*\b(safe|secure|selamat)\b/, 't_sec'],
    [/\b(on|kat|di|dalam|guna|use|install|pasang)( on| kat| di| my| dalam)? (mac|macbook|ipad|iphone|android|tablet|chromebook|linux)\b/, 's_req'],
    [/\b(is it|adakah|ke) (free|percuma)\b|\b(free|percuma) (ke|tak|or not)\b/, 'b_cost'],
    [/\bwho (built|made|created|developed)\b|\bsiapa (bina|buat|cipta|develop)\b/, 'b_maker']
  ];
  // words that carry no meaning on their own (English + Malay)
  var STOP = ('a an the is are am was were be been do does did can could would should will shall may might must i me my mine you your we our us it its this that these those ' +
    'to of in on at for from with by about as into how what when where which who whom why please pls plz hi hello hey thanks thank ok okay rasumi apps app ' +
    'saya aku awak kau anda kita kami ini itu ni tu nak mahu hendak boleh ke kah tak tidak ada apa bagaimana macam mana camne cmne siapa bila kenapa mengapa yang dan atau untuk dengan ' +
    'di dalam pada dari kepada tolong sila je jer lah la pun sahaja saja tu ni tell me explain').split(' ');
  var OFF = ['I can only help with Rasumi Apps. That question is outside what I\'m here for. Ask me about installing, signing in, using the apps or our technology.',
             'Saya hanya boleh membantu tentang Rasumi Apps. Soalan itu di luar skop saya. Tanya saya tentang pemasangan, log masuk, penggunaan aplikasi atau teknologi kami.'];
  var CATS = [['Install / download', 'Pasang / muat turun'], ['Sign-in / 2FA', 'Log masuk / 2FA'], ['Using the apps', 'Guna aplikasi'], ['Invitation link', 'Link jemputan'], ['Other', 'Lain-lain']];
  return { N: N, TOPICS: TOPICS, AG: AG, SMALL: SMALL, OFF: OFF, CATS: CATS, INTENTS: INTENTS, STOP: STOP };
})();
