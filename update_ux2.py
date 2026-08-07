import os

js_path = r"d:\Antigravity_Project\tectum_portal_railway\static\js\app.js"

with open(js_path, "r", encoding="utf-8") as f:
    js_content = f.read()

# Make the submitShiftReport success branch use showNotification
old_success = """            clearReportDraft();
            saveLastLineAndShift(data.line, data.shift_name);
            const formContainer = document.getElementById('report-form-container');
            const successScreen = document.getElementById('report-success-screen');
            if (formContainer) formContainer.style.display = 'none';
            if (successScreen) successScreen.style.display = 'block';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadData();
        } else {"""

new_success = """            clearReportDraft();
            saveLastLineAndShift(data.line, data.shift_name);
            const formContainer = document.getElementById('report-form-container');
            const successScreen = document.getElementById('report-success-screen');
            if (formContainer) formContainer.style.display = 'none';
            if (successScreen) successScreen.style.display = 'block';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadData();
            showNotification('success', 'Смена отправлена!', 'Данные рапорта смены успешно загружены в облако.');
        } else {"""

js_content = js_content.replace(old_success, new_success)

with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)

print("Done")
