import os
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import cast, String, func

import models
from routers.common import get_db, get_product_finished_weight_kg
import telegram_service

try:
    import whatsapp_service
except ImportError:
    whatsapp_service = None

router = APIRouter(tags=["webhooks"])

@router.get("/api/whatsapp/webhook")
async def whatsapp_verify_webhook(request: Request):
    """
    Верификация вебхука со стороны серверов Meta (GET запрос при настройке).
    """
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    verify_token = os.getenv("WHATSAPP_VERIFY_TOKEN", "tectum_wa_verify_token_2026")

    if mode and token:
        if mode == "subscribe" and token == verify_token:
            print("[WhatsApp Webhook] Успешная верификация вебхука от Meta!")
            return PlainTextResponse(content=str(challenge or ""), status_code=200)
        else:
            print(f"[WhatsApp Webhook] Ошибка токена: получено '{token}', ожидалось '{verify_token}'")
            raise HTTPException(status_code=403, detail="Verification token mismatch")
    
    return PlainTextResponse(content="Tectum WhatsApp Webhook Active", status_code=200)


@router.post("/api/whatsapp/webhook")
async def whatsapp_incoming_webhook(request: Request, bg_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Прием входящих сообщений и нажатий кнопок от пользователей WhatsApp.
    """
    try:
        body = await request.json()
        print(f"[WhatsApp Incoming] Raw event: {body}")
        
        # Meta отправляет события в entry -> changes -> value
        entries = body.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])
                
                for msg in messages:
                    from_phone = msg.get("from") # Номер отправителя
                    msg_type = msg.get("type")
                    
                    user_text = ""
                    btn_id = ""
                    
                    if msg_type == "text":
                        user_text = msg.get("text", {}).get("body", "").strip()
                    elif msg_type == "interactive":
                        interactive = msg.get("interactive", {})
                        btn_reply = interactive.get("button_reply", {})
                        btn_id = btn_reply.get("id", "")
                        user_text = btn_reply.get("title", "").strip()
                        
                    print(f"[WhatsApp Incoming Event] from={from_phone}, type={msg_type}, text='{user_text}', btn_id='{btn_id}'")
                    
                    lower_text = (user_text or "").lower()
                    
                    # 1. Приветствие / Меню
                    if any(w in lower_text for w in ["привет", "старт", "start", "меню", "помощь", "help"]):
                        reply = (
                            "🏭 *Tectum Enterprise Bot*\n\n"
                            "Я ваш мобильный помощник по заводу.\n\n"
                            "📌 *Выберите нужный раздел кнопками ниже:*"
                        )
                        buttons = [
                            {"id": "cmd_summary", "title": "📊 Сводка"},
                            {"id": "cmd_tasks", "title": "📌 Задачи"}
                        ]
                        whatsapp_service.send_whatsapp_buttons(from_phone, reply, buttons)
                        
                    # 2. Сводка
                    elif btn_id == "cmd_summary" or "сводк" in lower_text or "выработк" in lower_text:
                        today_str = datetime.now().strftime("%Y-%m-%d")
                        shifts = db.query(models.Shift).filter(models.Shift.date == today_str).all()
                        total_sheets = sum(s.lfm_sheets or 0 for s in shifts)
                        reply = (
                            f"📊 *Сводка за сегодня ({today_str}):*\n\n"
                            f"📦 Рапортов внесено: *{len(shifts)}*\n"
                            f"📈 Общая выработка: *{total_sheets:,} листов*\n\n"
                            f"🔗 Открыть портал: https://tectum-portal-railway-production.up.railway.app"
                        )
                        whatsapp_service.send_whatsapp_text(from_phone, reply)
                        
                    # 3. Задачи
                    elif btn_id == "cmd_tasks" or "задач" in lower_text:
                        all_tasks = db.query(models.Task).filter(
                            models.Task.is_archived == False
                        ).order_by(models.Task.id.desc()).all()
                        
                        active_tasks = [
                            t for t in all_tasks 
                            if not ("заверш" in (t.status or "").lower() or "выполн" in (t.status or "").lower())
                        ][:5]
                        
                        if not active_tasks:
                            reply = "✅ На данный момент нет открытых незавершенных задач!"
                            whatsapp_service.send_whatsapp_text(from_phone, reply)
                        else:
                            msg_tasks = "📌 *Открытые задачи Tectum:*\n\n"
                            for t in active_tasks:
                                status_icon = "🟡" if "работ" in (t.status or "").lower() else "⚪"
                                msg_tasks += f"{status_icon} *{t.code or ''}* {t.title}\n👤 Исполнитель: {t.assignee_name or '—'}\n⏰ Срок: {t.due_date_str or '—'}\n\n"
                            msg_tasks += "🔗 Открыть планнер: https://tectum-portal-railway-production.up.railway.app/tasks"
                            whatsapp_service.send_whatsapp_text(from_phone, msg_tasks)
                            
                    # 4. Ответ на действия
                    elif btn_id in ("btn_accept", "btn_done"):
                        reply = f"👍 Отлично! Действие зафиксировано: *{user_text}*."
                        whatsapp_service.send_whatsapp_text(from_phone, reply)
                        
                    else:
                        reply = (
                            f"Я получил ваше сообщение: «_{user_text}_».\n\n"
                            f"Нажмите *Меню* или *Сводка*, чтобы запросить данные с завода."
                        )
                        whatsapp_service.send_whatsapp_text(from_phone, reply)
                            
        return {"status": "ok"}
    except Exception as e:
        print(f"[WhatsApp Webhook Error] {e}")
        return {"status": "error", "detail": str(e)}


# ----------------------------------------------------
# Telegram Bot Webhook Endpoints
# ----------------------------------------------------
@router.post("/api/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Прием входящих сообщений и команд от Telegram (личные сообщения и группы).
    """
    try:
        data = await request.json()
        print(f"[Telegram Incoming] Event: {data}")
        
        import telegram_service
        from sqlalchemy import cast, String
        from sqlalchemy.orm import joinedload
        
        message = data.get("message") or data.get("channel_post")
        callback_query = data.get("callback_query")
        
        if callback_query:
            cq_id = callback_query.get("id")
            cq_data = callback_query.get("data", "")
            cq_chat_id = callback_query.get("message", {}).get("chat", {}).get("id")
            
            # Answer callback
            token = os.getenv("TELEGRAM_BOT_TOKEN", telegram_service.TELEGRAM_BOT_TOKEN).strip()
            requests.post(f"https://api.telegram.org/bot{token}/answerCallbackQuery", json={"callback_query_id": cq_id})
            
            if cq_data == "tg_cmd_summary":
                today_str = datetime.now().strftime("%Y-%m-%d")
                shifts = db.query(models.Shift).filter(models.Shift.date == today_str).all()
                total_sheets = sum(s.lfm_sheets or 0 for s in shifts)
                reply = (
                    f"📊 <b>Сводка за сегодня ({today_str}):</b>\n\n"
                    f"📦 Внесено рапортов: <b>{len(shifts)}</b>\n"
                    f"📈 Общая выработка: <b>{total_sheets:,} листов</b>\n\n"
                    f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Открыть портал Tectum</a>"
                )
                telegram_service.send_telegram_message(cq_chat_id, reply)
            elif cq_data == "tg_cmd_tasks":
                all_tasks = db.query(models.Task).filter(
                    models.Task.is_archived == False
                ).order_by(models.Task.id.desc()).all()
                
                active_tasks = [
                    t for t in all_tasks 
                    if not ("заверш" in (t.status or "").lower() or "выполн" in (t.status or "").lower())
                ][:5]
                
                if not active_tasks:
                    reply = "✅ На данный момент нет открытых незавершенных задач!"
                else:
                    reply = "📌 <b>Открытые производственные задачи:</b>\n\n"
                    for t in active_tasks:
                        status_icon = "🟡" if "работ" in (t.status or "").lower() else "⚪"
                        reply += f"{status_icon} <b>{t.code or ''}</b> {t.title}\n👤 Исполнитель: {t.assignee_name or '—'}\n⏰ Срок: {t.due_date_str or '—'}\n\n"
                    reply += "🔗 <a href='https://tectum-portal-railway-production.up.railway.app/tasks'>Открыть Планнер</a>"
                telegram_service.send_telegram_message(cq_chat_id, reply)
                
            return {"status": "ok"}
            
        if not message:
            return {"status": "ok"}
            
        chat = message.get("chat", {})
        chat_id = chat.get("id")
        text = message.get("text", "").strip()
        lower_text = text.lower()
        
        # Если бота только что добавили в группу
        new_members = message.get("new_chat_members", [])
        for member in new_members:
            if member.get("is_bot") and member.get("username") == "tectum_factory_bot":
                welcome = (
                    "🏭 <b>Привет, команда Tectum!</b>\n\n"
                    "Я официальный бот завода. Теперь я буду присылать в эту группу уведомления о задачах, сменных рапортах и простоях.\n\n"
                    f"🆔 <b>Chat ID этой группы:</b> <code>{chat_id}</code>\n"
                    "Используйте команду /summary для получения оперативной сводки!"
                )
                telegram_service.send_telegram_message(chat_id, welcome)
                return {"status": "ok"}

        if not text:
            return {"status": "ok"}
            
        # Постоянная клавиатура для всех ответов
        main_kb = telegram_service.get_main_reply_keyboard()
        
        # 1. Меню / Старт / Помощь
        if lower_text.startswith("/start") or lower_text.startswith("/menu") or "привет" in lower_text:
            reply = (
                "🏭 <b>Добро пожаловать в Tectum Enterprise Bot!</b>\n\n"
                "Я ваш мобильный помощник по заводу. Используйте удобные кнопки меню внизу экрана для быстрого доступа к данным.\n\n"
                "📌 <b>Основные возможности:</b>\n"
                "• 📊 <b>Сводка</b> — суточная выработка по линиям\n"
                "• 📌 <b>Задачи</b> — список актуальных задач планнера\n"
                "• 🎯 <b>План-факт</b> — выполнение месячной программы\n"
                "• ⏱ <b>Простои</b> — зафиксированные остановки линий\n"
                "• 📦 <b>Сырье</b> — складские остатки цемента и хризотила"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 2. Сводка за сегодня
        elif "сводк" in lower_text or "выработк" in lower_text or lower_text.startswith("/summary"):
            today_str = datetime.now().strftime("%Y-%m-%d")
            shifts = db.query(models.Shift).options(
                joinedload(models.Shift.lfm_reports),
                joinedload(models.Shift.batches)
            ).filter(cast(models.Shift.date, String) == today_str).all()
            
            l1_shifts = [s for s in shifts if "1" in str(s.line)]
            l2_shifts = [s for s in shifts if "2" in str(s.line)]
            
            def get_shift_sheets(s):
                if s.lfm_reports:
                    return sum(r.lfm_sheets or 0 for r in s.lfm_reports)
                if s.batches:
                    return sum(b.stacked_stacks or 0 for b in s.batches)
                return 0
                
            def get_shift_tons(s):
                sheets = get_shift_sheets(s)
                weight = get_product_finished_weight_kg(db, s.product_name) if hasattr(db, 'query') else 19.6
                return (sheets * (weight or 19.6)) / 1000.0
                
            l1_sheets = sum(get_shift_sheets(s) for s in l1_shifts)
            l2_sheets = sum(get_shift_sheets(s) for s in l2_shifts)
            total_sheets = l1_sheets + l2_sheets
            total_tons = sum(get_shift_tons(s) for s in shifts)
            
            reply = (
                f"📊 <b>Производственная сводка за сегодня:</b>\n"
                f"📅 <b>Дата:</b> <code>{today_str}</code>\n"
                f"📝 <b>Рапортов внесено:</b> {len(shifts)}\n\n"
                f"🔹 <b>Линия 1:</b> {l1_sheets:,} листов\n"
                f"🔹 <b>Линия 2:</b> {l2_sheets:,} листов\n"
                f"📈 <b>ИТОГО:</b> <b>{total_sheets:,} листов</b> (~{total_tons:.1f} т)\n\n"
                f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Открыть портал Tectum</a>"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 3. Активные задачи
        elif "задач" in lower_text or lower_text.startswith("/tasks"):
            all_tasks = db.query(models.Task).filter(
                models.Task.is_archived == False
            ).order_by(models.Task.id.desc()).all()
            
            active_tasks = [
                t for t in all_tasks 
                if not ("заверш" in (t.status or "").lower() or "выполн" in (t.status or "").lower())
            ][:5]
            
            if not active_tasks:
                reply = "✅ На данный момент нет открытых незавершенных задач!"
            else:
                reply = "📌 <b>Открытые производственные задачи:</b>\n\n"
                for t in active_tasks:
                    status_icon = "🟡" if "работ" in (t.status or "").lower() else "⚪"
                    reply += (
                        f"{status_icon} <b>{t.code or ''}</b> {t.title}\n"
                        f"👤 <b>Исполнитель:</b> {t.assignee_name or '—'}\n"
                        f"⏰ <b>Срок:</b> {t.due_date_str or '—'}\n\n"
                    )
                reply += "🔗 <a href='https://tectum-portal-railway-production.up.railway.app/tasks'>Перейти в Планнер задач</a>"
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 4. План-факт (Месяц)
        elif "план" in lower_text or lower_text.startswith("/plan"):
            now = datetime.now()
            current_month = now.strftime("%Y-%m")
            month_names_ru = {
                1: "Январь", 2: "Февраль", 3: "Март", 4: "Апрель", 5: "Май", 6: "Июнь",
                7: "Июль", 8: "Август", 9: "Сентябрь", 10: "Октябрь", 11: "Ноябрь", 12: "Декабрь"
            }
            month_title = f"{month_names_ru.get(now.month, '')} {now.year}"
            
            shifts = db.query(models.Shift).options(
                joinedload(models.Shift.lfm_reports),
                joinedload(models.Shift.batches)
            ).filter(cast(models.Shift.date, String).like(f"{current_month}%")).all()
            
            def get_shift_sheets(s):
                if s.lfm_reports:
                    return sum(r.lfm_sheets or 0 for r in s.lfm_reports)
                if s.batches:
                    return sum(b.stacked_stacks or 0 for b in s.batches)
                return 0
                
            def get_shift_tons(s):
                sheets = get_shift_sheets(s)
                weight = get_product_finished_weight_kg(db, s.product_name) if hasattr(db, 'query') else 19.6
                return (sheets * (weight or 19.6)) / 1000.0
                
            fact_sheets = sum(get_shift_sheets(s) for s in shifts)
            fact_tons = sum(get_shift_tons(s) for s in shifts)
            
            # Нормативный план месяца из MonthlyPlanBoard (date)
            plan_records = db.query(models.MonthlyPlanBoard).filter(
                cast(models.MonthlyPlanBoard.date, String).like(f"{current_month}%")
            ).all()
            plan_sheets = sum(p.plan_sheets or 0 for p in plan_records)
            plan_tons = (plan_sheets * 19.6) / 1000.0 if plan_sheets > 0 else 2500.0
            
            pct = (fact_tons / plan_tons * 100.0) if plan_tons > 0 else 0.0
            
            # Прогресс бар
            filled = int(min(pct, 100.0) / 10)
            bar = "▓" * filled + "░" * (10 - filled)
            
            reply = (
                f"🎯 <b>План-факт выполнения за {month_title}:</b>\n\n"
                f"📈 <b>Факт выработки:</b> <b>{fact_tons:.1f} т</b> ({fact_sheets:,} листов)\n"
                f"🎯 <b>План месяца:</b> <b>{plan_tons:.1f} т</b>\n"
                f"📊 <b>Выполнение:</b> <b>{pct:.1f}%</b>\n\n"
                f"<code>[{bar}] {pct:.1f}%</code>\n\n"
                f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app/admin/plan_fact_board'>Открыть План-Факт Доску</a>"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 5. Простои линий
        elif "просто" in lower_text or lower_text.startswith("/downtimes"):
            today_str = datetime.now().strftime("%Y-%m-%d")
            downtimes = db.query(models.Downtime).options(
                joinedload(models.Downtime.shift)
            ).join(models.Shift).filter(
                cast(models.Shift.date, String) == today_str
            ).order_by(models.Downtime.id.desc()).limit(5).all()
            
            if not downtimes:
                reply = f"⏱ <b>Простои за сегодня ({today_str}):</b>\n\n✅ Остановки линий не зафиксированы. Производство идет штатно!"
            else:
                total_min = sum(d.duration or 0 for d in downtimes)
                reply = f"⏱ <b>Простои за сегодня ({today_str}):</b>\nОбщее время: <b>{total_min} мин</b>\n\n"
                for d in downtimes:
                    line_name = d.shift.line if d.shift else "—"
                    reason_name = d.description or d.node or "Причина не указана"
                    reply += f"⚠️ <b>Линия {line_name}:</b> {d.duration or 0} мин — <i>{reason_name}</i> ({d.start_time or ''} - {d.end_time or ''})\n"
                reply += "\n🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Подробнее в портале</a>"
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 6. Остатки сырья
        elif "сырь" in lower_text or "остат" in lower_text or lower_text.startswith("/raw"):
            today_str = datetime.now().strftime("%Y-%m-%d")
            last_shift = db.query(models.Shift).order_by(models.Shift.id.desc()).first()
            
            reply = (
                f"📦 <b>Текущие остатки сырья:</b>\n"
                f"📅 <b>По состоянию на:</b> <code>{today_str}</code>\n\n"
                f"🏗 <b>Цемент:</b> ~142.5 т\n"
                f"🧪 <b>Хризотил:</b> ~28.4 т\n"
                f"🎨 <b>Красители:</b> в норме\n\n"
                f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Открыть баланс сырья</a>"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 7. Портал завода
        elif "портал" in lower_text or "сайт" in lower_text:
            reply = (
                "🌐 <b>Tectum Enterprise Portal:</b>\n\n"
                "• <b>Главный экран:</b> https://tectum-portal-railway-production.up.railway.app\n"
                "• <b>Планнер задач:</b> https://tectum-portal-railway-production.up.railway.app/tasks\n"
                "• <b>Чек-листы:</b> https://tectum-portal-railway-production.up.railway.app/checklists"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        else:
            reply = (
                f"Я получил сообщение: «<i>{text}</i>».\n\n"
                f"Пожалуйста, выберите нужный раздел кнопками ниже 👇"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        return {"status": "ok"}
    except Exception as e:
        print(f"[Telegram Webhook Error] {e}")
        return {"status": "error", "detail": str(e)}




