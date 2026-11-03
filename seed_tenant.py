import logging
from sqlalchemy.orm import Session
from database import SessionLocal
import models

logger = logging.getLogger("tectum.tenant_seed")

INITIAL_WORKSHOPS = [
    {
        "id": "xci",
        "name": "Цех хризотилцементных изделий (ХЦИ)",
        "type": "cement",
        "plant_id": "shymkent",
    },
    {
        "id": "agb",
        "name": "Цех автоклавного газобетона (АГБ)",
        "type": "aerated_concrete",
        "plant_id": "shymkent",
    },
    {
        "id": "lkc",
        "name": "Лакокрасочный цех (ЛКЦ)",
        "type": "paint",
        "plant_id": "shymkent",
    },
    {
        "id": "stmo",
        "name": "Цех СТМО",
        "type": "stmo",
        "plant_id": "shymkent",
    },
    {
        "id": "skk",
        "name": "Служба контроля качества и сортировки (СКК)",
        "type": "qcd",
        "plant_id": "shymkent",
    },
]

def seed_tenant_structure(db: Session = None):
    """
    Идемпотентная инициализация завода Шымкент, 5 цехов и плавная миграция
    пользователей из Master и PlannerEmployee в единую таблицу User.
    """
    close_at_end = False
    if db is None:
        db = SessionLocal()
        close_at_end = True

    try:
        # 1. Завод Шымкент
        shymkent = db.query(models.Plant).filter(models.Plant.id == "shymkent").first()
        if not shymkent:
            shymkent = models.Plant(
                id="shymkent",
                name="Шымкент",
                timezone="Asia/Almaty",
                is_active=True
            )
            db.add(shymkent)
            db.flush()
            print("[TenantSeed] Завод Шымкент успешно зарегистрирован.")

        # 2. Пять цехов Шымкента
        for w_data in INITIAL_WORKSHOPS:
            workshop = db.query(models.Workshop).filter(models.Workshop.id == w_data["id"]).first()
            if not workshop:
                workshop = models.Workshop(
                    id=w_data["id"],
                    plant_id=w_data["plant_id"],
                    name=w_data["name"],
                    type=w_data["type"],
                    is_active=True
                )
                db.add(workshop)
                print(f"[TenantSeed] Цех '{w_data['name']}' ({w_data['id']}) добавлен.")
            else:
                if not workshop.name or workshop.name != w_data["name"]:
                    workshop.name = w_data["name"]
        db.flush()

        # 3. Синхронизация мастеров смен и руководства в единую таблицу User
        masters = db.query(models.Master).all()
        for m in masters:
            clean_name = m.name.strip() if m.name else ""
            if not clean_name:
                continue

            user = db.query(models.User).filter(models.User.name == clean_name).first()
            if not user:
                user = models.User(
                    name=clean_name,
                    email=m.email.strip() if m.email else None,
                    pin_code=m.pin.strip() if m.pin else None,
                    is_active=True
                )
                db.add(user)
                db.flush()
                print(f"[TenantSeed] Пользователь '{clean_name}' перенесен в User.")
            else:
                if m.pin and not user.pin_code:
                    user.pin_code = m.pin.strip()
                if m.email and not user.email:
                    user.email = m.email.strip()

            # Строгое определение роли: руководство сохраняет директорский статус
            m_role = (m.role or "").lower()
            if m_role == "admin" or clean_name.startswith("Левда") or m.pin == "6282":
                role_code = "admin"
                target_plant = None
                target_workshop = None
            elif m_role in ("director", "tech_director", "production_head"):
                role_code = m_role
                target_plant = "shymkent"
                target_workshop = None
            elif "лкц" in m_role or m_role == "lkc_master":
                role_code = "workshop_master"
                target_plant = "shymkent"
                target_workshop = "lkc"
            elif "скк" in m_role or m_role == "qcd":
                role_code = "qcd_inspector"
                target_plant = "shymkent"
                target_workshop = "skk"
            else:
                role_code = "workshop_master"
                target_plant = "shymkent"
                target_workshop = "xci"

            scope = db.query(models.UserRoleScope).filter(
                models.UserRoleScope.user_id == user.id,
                models.UserRoleScope.role_code == role_code
            ).first()

            if not scope:
                scope = models.UserRoleScope(
                    user_id=user.id,
                    role_code=role_code,
                    plant_id=target_plant,
                    workshop_id=target_workshop,
                    is_active=True
                )
                db.add(scope)

        # 4. Синхронизация сотрудников ИТР из PlannerEmployee
        employees = db.query(models.PlannerEmployee).all()
        for emp in employees:
            clean_name = emp.name.strip() if emp.name else ""
            if not clean_name:
                continue

            user = db.query(models.User).filter(models.User.name == clean_name).first()
            if not user:
                user = models.User(
                    name=clean_name,
                    email=emp.email.strip() if emp.email else None,
                    pin_code=emp.pin_code.strip() if emp.pin_code else None,
                    is_active=emp.is_active
                )
                db.add(user)
                db.flush()
                print(f"[TenantSeed] Сотрудник ИТР '{clean_name}' перенесен в User.")
            else:
                if emp.pin_code and not user.pin_code:
                    user.pin_code = emp.pin_code.strip()
                if emp.email and not user.email:
                    user.email = emp.email.strip()

            emp_role = (getattr(emp, "role", "") or "").lower()
            if emp_role == "admin" or clean_name.startswith("Левда") or getattr(emp, "pin_code", "") == "6282":
                role_code = "admin"
                target_plant = None
            elif emp_role in ("director", "tech_director", "production_head"):
                role_code = emp_role
                target_plant = "shymkent"
            else:
                role_code = "itr"
                target_plant = "shymkent"

            scope = db.query(models.UserRoleScope).filter(
                models.UserRoleScope.user_id == user.id,
                models.UserRoleScope.role_code == role_code
            ).first()

            if not scope:
                scope = models.UserRoleScope(
                    user_id=user.id,
                    role_code=role_code,
                    plant_id=target_plant,
                    workshop_id=None,
                    is_active=True
                )
                db.add(scope)

        # 5. Гарантия учетной записи суперадмина
        admin_user = db.query(models.User).filter(models.User.pin_code == "6282").first()
        if not admin_user:
            admin_user = models.User(
                name="Левда М.",
                pin_code="6282",
                is_active=True
            )
            db.add(admin_user)
            db.flush()

        admin_scope = db.query(models.UserRoleScope).filter(
            models.UserRoleScope.user_id == admin_user.id,
            models.UserRoleScope.role_code == "admin"
        ).first()
        if not admin_scope:
            admin_scope = models.UserRoleScope(
                user_id=admin_user.id,
                role_code="admin",
                plant_id=None,
                workshop_id=None,
                is_active=True
            )
            db.add(admin_scope)

        db.commit()
        print("[TenantSeed] Синхронизация структуры и пользователей завершена успешно.")
    except Exception as e:
        db.rollback()
        print(f"[TenantSeed ERROR] Ошибка инициализации: {e}")
        raise
    finally:
        if close_at_end:
            db.close()

if __name__ == "__main__":
    seed_tenant_structure()
