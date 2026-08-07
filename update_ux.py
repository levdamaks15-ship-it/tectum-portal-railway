import os

js_path = r"d:\Antigravity_Project\tectum_portal_railway\static\js\app.js"
css_path = r"d:\Antigravity_Project\tectum_portal_railway\static\css\style.css"

with open(css_path, "a", encoding="utf-8") as f:
    f.write("\n@keyframes spin {\n  to { transform: rotate(360deg); }\n}\n")

with open(js_path, "r", encoding="utf-8") as f:
    js_content = f.read()

helpers = """
// UX Helpers
function showNotification(type, title, message) {
    const modal = document.getElementById('universal-notification-modal');
    const overlay = document.getElementById('universal-notification-overlay');
    const iconContainer = document.getElementById('unm-icon');
    const iconText = document.getElementById('unm-icon-text');
    const titleEl = document.getElementById('unm-title');
    const messageEl = document.getElementById('unm-message');
    const btn = document.getElementById('unm-btn');

    if (!modal || !overlay) return;

    if (type === 'success') {
        iconContainer.style.background = 'rgba(34, 197, 94, 0.2)';
        iconContainer.style.border = '2px solid #22c55e';
        iconText.style.color = '#22c55e';
        iconText.innerHTML = '✓';
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        btn.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.3)';
    } else if (type === 'error') {
        iconContainer.style.background = 'rgba(239, 68, 68, 0.2)';
        iconContainer.style.border = '2px solid #ef4444';
        iconText.style.color = '#ef4444';
        iconText.innerHTML = '✕';
        btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        btn.style.boxShadow = '0 8px 20px rgba(239, 68, 68, 0.3)';
    }

    titleEl.innerText = title;
    messageEl.innerText = message;

    overlay.style.display = 'block';
    modal.style.display = 'block';
}

function closeUniversalNotification() {
    const overlay = document.getElementById('universal-notification-overlay');
    const modal = document.getElementById('universal-notification-modal');
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
}

function setButtonLoading(buttonId, isLoading, originalText = '') {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = `<span style="display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-radius:50%; border-top-color:#fff; animation:spin 1s linear infinite; margin-right:8px; vertical-align:middle;"></span> Отправка...`;
        btn.style.opacity = '0.7';
        btn.style.cursor = 'wait';
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalText || originalText;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}
"""

js_content = js_content.replace("// Chart instances", helpers + "\n// Chart instances")

# Update submitShiftReport
old_submit_start = """    if (!data.date || !data.shift_name || !data.line || isNaN(data.master_id) || !data.product_name) {
        alert("Пожалуйста, заполните все обязательные поля заголовка смены!");
        return;
    }

    try {"""
new_submit_start = """    if (!data.date || !data.shift_name || !data.line || isNaN(data.master_id) || !data.product_name) {
        showNotification('error', 'Ошибка', "Пожалуйста, заполните все обязательные поля заголовка смены!");
        return;
    }

    setButtonLoading('btn-submit-shift-report', true);
    try {"""
js_content = js_content.replace(old_submit_start, new_submit_start)

old_submit_end = """            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadData();
        } else {
            const err = await res.json();
            alert(`Ошибка сохранения: ${err.detail}`);
        }
    } catch(e) {
        alert(`Сетевая ошибка: ${e.message}`);
    }
}"""
new_submit_end = """            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadData();
        } else {
            const err = await res.json();
            showNotification('error', 'Ошибка сохранения', err.detail || 'Неизвестная ошибка сервера');
        }
    } catch(e) {
        showNotification('error', 'Сетевая ошибка', e.message);
    } finally {
        setButtonLoading('btn-submit-shift-report', false);
    }
}"""
js_content = js_content.replace(old_submit_end, new_submit_end)

# Update addReceipt
old_receipt_start = """    if (!date || !shift_name || !line || !master_id) {
        alert("Пожалуйста, заполните параметры смены (дата, смена, линия, мастер) перед добавлением прихода сырья.");
        return;
    }"""
new_receipt_start = """    if (!date || !shift_name || !line || !master_id) {
        showNotification('error', 'Ошибка', "Пожалуйста, заполните параметры смены (дата, смена, линия, мастер) перед добавлением прихода сырья.");
        return;
    }
    setButtonLoading('btn-submit-receipt', true);"""
js_content = js_content.replace(old_receipt_start, new_receipt_start)

old_receipt_end = """            loadReceipts(shift);
            alert("Приход сырья успешно добавлен!");
        } else {
            const err = await res.json();
            alert("Ошибка при добавлении прихода: " + (err.detail || 'Неизвестная ошибка'));
        }
    } catch(e) {
        alert("Ошибка: " + e.message);
    }
}"""
new_receipt_end = """            loadReceipts(shift);
            showNotification('success', 'Отлично!', 'Приход сырья успешно сохранен в облако.');
        } else {
            const err = await res.json();
            showNotification('error', 'Ошибка сохранения', err.detail || 'Неизвестная ошибка');
        }
    } catch(e) {
        showNotification('error', 'Сетевая ошибка', e.message);
    } finally {
        setButtonLoading('btn-submit-receipt', false);
    }
}"""
js_content = js_content.replace(old_receipt_end, new_receipt_end)

# Update addJournalDowntime
old_dt_start1 = """    if (!date) {
        alert("Выберите дату!");
        return;
    }"""
new_dt_start1 = """    if (!date) {
        showNotification('error', 'Ошибка', "Выберите дату!");
        return;
    }
    setButtonLoading('btn-add-dt', true);"""
js_content = js_content.replace(old_dt_start1, new_dt_start1)

old_dt_start2 = """            if (createRes.ok) {
                const createdShift = await createRes.json();
                shiftId = createdShift.id;
                document.getElementById('journal-dt-active-shift-id').value = shiftId;
            } else {
                alert("Не удалось создать рапорт смены для этого простоя!");
                return;
            }
        } catch(e) {
            console.error(e);
            alert("Ошибка сети при создании рапорта смены!");
            return;
        }"""
new_dt_start2 = """            if (createRes.ok) {
                const createdShift = await createRes.json();
                shiftId = createdShift.id;
                document.getElementById('journal-dt-active-shift-id').value = shiftId;
            } else {
                showNotification('error', 'Ошибка', "Не удалось создать рапорт смены для этого простоя!");
                setButtonLoading('btn-add-dt', false);
                return;
            }
        } catch(e) {
            console.error(e);
            showNotification('error', 'Сетевая ошибка', "Ошибка сети при создании рапорта смены!");
            setButtonLoading('btn-add-dt', false);
            return;
        }"""
js_content = js_content.replace(old_dt_start2, new_dt_start2)

old_dt_end1 = """    if (breakdownsList.length === 0) {
        alert("Добавьте хотя бы одну причину (участок, узел, причина)!");
        return;
    }"""
new_dt_end1 = """    if (breakdownsList.length === 0) {
        showNotification('error', 'Ошибка', "Добавьте хотя бы одну причину (участок, узел, причина)!");
        setButtonLoading('btn-add-dt', false);
        return;
    }"""
js_content = js_content.replace(old_dt_end1, new_dt_end1)

old_dt_end2 = """    if (!data.start_time) {
        alert("Укажите время начала простоя!");
        return;
    }"""
new_dt_end2 = """    if (!data.start_time) {
        showNotification('error', 'Ошибка', "Укажите время начала простоя!");
        setButtonLoading('btn-add-dt', false);
        return;
    }"""
js_content = js_content.replace(old_dt_end2, new_dt_end2)

old_dt_end3 = """        if (res.ok) {
            saveLastLineAndShift(line, shift_name);
            alert("Простой успешно зафиксирован!");
            refreshDowntimesTable();
        } else {
            const err = await res.json();
            if (Array.isArray(err.detail)) {
                alert("Ошибка валидации: " + err.detail.map(e => e.msg).join("; "));
            } else {
                alert(`Ошибка: ${err.detail}`);
            }
        }
    } catch(e) {
        alert(e.message);
    }
}"""
new_dt_end3 = """        if (res.ok) {
            saveLastLineAndShift(line, shift_name);
            showNotification('success', 'Отлично!', 'Простой успешно зафиксирован и отправлен в облако.');
            refreshDowntimesTable();
        } else {
            const err = await res.json();
            if (Array.isArray(err.detail)) {
                showNotification('error', 'Ошибка валидации', err.detail.map(e => e.msg).join("; "));
            } else {
                showNotification('error', 'Ошибка', err.detail || 'Неизвестная ошибка сервера');
            }
        }
    } catch(e) {
        showNotification('error', 'Сетевая ошибка', e.message);
    } finally {
        setButtonLoading('btn-add-dt', false);
    }
}"""
js_content = js_content.replace(old_dt_end3, new_dt_end3)

with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)

print("Done")
