import os
import json
import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import models
import schemas
from routers.common import get_db, check_admin_session
import ai_assistant_service

logger = logging.getLogger("ai_assistant")

router = APIRouter(prefix="/api/ai", tags=["ai_assistant"])


@router.get("/conversations", response_model=List[schemas.AIChatConversationOut])
def get_conversations(
    request: Request,
    db: Session = Depends(get_db)
):
    """Возвращает список сохраненных диалогов текущего пользователя (или все для админа)."""
    user = check_admin_session(request, db)
    conversations = db.query(models.AIChatConversation)\
        .filter(models.AIChatConversation.is_active == True)\
        .order_by(models.AIChatConversation.updated_at.desc())\
        .limit(50)\
        .all()
    return conversations


@router.post("/conversations", response_model=schemas.AIChatConversationOut)
def create_conversation(
    request: Request,
    db: Session = Depends(get_db)
):
    """Создает новый диалог с ИИ-ассистентом."""
    user = check_admin_session(request, db)
    new_conv = models.AIChatConversation(
        user_id=user.id,
        title="Новый диалог",
        is_active=True
    )
    db.add(new_conv)
    db.commit()
    db.refresh(new_conv)
    return new_conv


@router.get("/conversations/{conversation_id}/messages", response_model=List[schemas.AIChatMessageOut])
def get_conversation_messages(
    conversation_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Возвращает историю сообщений указанного диалога."""
    check_admin_session(request, db)
    conv = db.query(models.AIChatConversation).filter(
        models.AIChatConversation.id == conversation_id,
        models.AIChatConversation.is_active == True
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    messages = db.query(models.AIChatMessage)\
        .filter(models.AIChatMessage.conversation_id == conversation_id)\
        .order_by(models.AIChatMessage.created_at.asc())\
        .all()
    return messages


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Мягкое удаление диалога."""
    check_admin_session(request, db)
    conv = db.query(models.AIChatConversation).filter(models.AIChatConversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    conv.is_active = False
    db.commit()
    return {"status": "ok", "message": "Диалог удален"}


@router.post("/chat/stream")
def chat_stream(
    payload: schemas.AIChatMessageCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Потоковый эндпоинт (SSE / text/event-stream):
    1. Сохраняет вопрос пользователя в БД.
    2. Потоково передает токены ответа DeepSeek.
    3. По завершении генерации сохраняет итоговый ответ ассистента в БД.
    """
    user = check_admin_session(request, db)
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")

    # Ищем или создаем диалог
    conversation = None
    if payload.conversation_id:
        conversation = db.query(models.AIChatConversation).filter(
            models.AIChatConversation.id == payload.conversation_id,
            models.AIChatConversation.is_active == True
        ).first()

    if not conversation:
        # Автоматически создаем диалог с заголовком из первых слов вопроса
        first_title = content[:40].strip() + ("..." if len(content) > 40 else "")
        conversation = models.AIChatConversation(
            user_id=user.id,
            title=first_title or "Новый диалог",
            is_active=True
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    # Сохраняем сообщение пользователя
    user_msg = models.AIChatMessage(
        conversation_id=conversation.id,
        role="user",
        content=content
    )
    db.add(user_msg)
    conversation.updated_at = datetime.utcnow()
    # Если заголовок стандартный, обновляем его
    if conversation.title == "Новый диалог":
        conversation.title = content[:40].strip() + ("..." if len(content) > 40 else "")
    db.commit()

    # Загружаем предыдущие сообщения для контекста
    history_db = db.query(models.AIChatMessage)\
        .filter(models.AIChatMessage.conversation_id == conversation.id)\
        .order_by(models.AIChatMessage.created_at.asc())\
        .all()

    chat_history = [{"role": m.role, "content": m.content} for m in history_db]
    conv_id = conversation.id

    def event_stream_generator():
        # Сначала отправляем служебный эвент с ID диалога, чтобы клиент знал к чему привязать
        yield f"event: conv_id\ndata: {json.dumps({'conversation_id': conv_id})}\n\n"

        full_assistant_reply = []
        try:
            for chunk in ai_assistant_service.stream_deepseek_chat(chat_history):
                full_assistant_reply.append(chunk)
                data = json.dumps({"chunk": chunk}, ensure_ascii=False)
                yield f"data: {data}\n\n"
        except Exception as err:
            logger.exception("Ошибка в генераторе потока: %s", err)
            err_data = json.dumps({"chunk": f"\n\n[Ошибка: {err}]"}, ensure_ascii=False)
            yield f"data: {err_data}\n\n"
        finally:
            # Сохраняем полный ответ ассистента в БД
            final_reply_text = "".join(full_assistant_reply).strip()
            if final_reply_text:
                try:
                    from database import SessionLocal
                    with SessionLocal() as db_session:
                        ai_msg = models.AIChatMessage(
                            conversation_id=conv_id,
                            role="assistant",
                            content=final_reply_text
                        )
                        db_session.add(ai_msg)
                        db_session.commit()
                except Exception as save_err:
                    logger.error("Ошибка сохранения ответа ассистента в БД: %s", save_err)

            yield "event: end\ndata: [DONE]\n\n"

    return StreamingResponse(
        event_stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
