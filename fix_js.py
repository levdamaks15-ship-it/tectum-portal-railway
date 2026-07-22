with open('static/js/admin.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the syncDirectoriesFromSharepoint function
old_js = '''async function syncDirectoriesFromSharepoint() {
    const btn = document.getElementById('btn-sync-sharepoint');
    const originalText = btn.innerHTML;
    
    if (!confirm("Вы действительно хотите синхронизировать нормативы сырья и справочник простоев из файла 'Справочник_Tectum.xlsx' в SharePoint? Данные будут перезаписаны!")) {
        return;
    }
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Синхронизация...';
        
        const res = await fetch('/api/admin/sync_directories_sharepoint', {
            method: 'POST'
        });
        
        const data = await res.json();
        
        if (res.ok) {
            alert(data.message || "Справочники успешно синхронизированы!");
            // Reload active tab
            if (document.getElementById('nav-norms').classList.contains('active')) {
                loadNorms();
            } else if (document.getElementById('nav-downtimes-dir').classList.contains('active')) {
                loadDowntimeDirectory();
            }
        } else {
            alert("Ошибка: " + (data.detail || "Неизвестная ошибка"));
        }
    } catch (err) {
        console.error(err);
        alert("Ошибка сети при синхронизации");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}'''

new_js = '''async function syncDirectoriesFromGoogle() {
    const btn = document.getElementById('btn-sync-google');
    const originalText = btn.innerHTML;
    
    if (!confirm("Вы действительно хотите синхронизировать нормативы сырья и справочник простоев из Google Sheets? Данные будут перезаписаны!")) {
        return;
    }
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Синхронизация...';
        
        const res = await fetch('/api/admin/sync_directories_google', {
            method: 'POST'
        });
        
        const data = await res.json();
        
        if (res.ok) {
            alert(data.message || "Справочники успешно синхронизированы!");
            // Reload active tab
            if (document.getElementById('nav-norms').classList.contains('active')) {
                loadNorms();
            } else if (document.getElementById('nav-downtimes-dir').classList.contains('active')) {
                loadDowntimeDirectory();
            }
        } else {
            alert("Ошибка: " + (data.detail || "Неизвестная ошибка"));
        }
    } catch (err) {
        console.error(err);
        alert("Ошибка сети при синхронизации");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}'''

content = content.replace(old_js, new_js)

with open('static/js/admin.js', 'w', encoding='utf-8') as f:
    f.write(content)
