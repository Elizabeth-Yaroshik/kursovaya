# Заполняет базу knitting.db тестовыми данными, если она пуста.

from database import (
    add_yarn, add_sample, add_project
)

def main():
    # Проверяем, есть ли уже данные

    print("Добавляем пряжу...")
    # Пряжа 1
    add_yarn(
        name="Alpaca Silk",
        weight_per_skein_g=50.0,
        length_per_skein_m=200.0,
        price_per_skein=500.0,
        composition="70% альпака, 30% шёлк"
    )
    # Пряжа 2
    add_yarn(
        name="Merino Wool",
        weight_per_skein_g=100.0,
        length_per_skein_m=300.0,
        price_per_skein=800.0,
        composition="100% меринос"
    )
    # Пряжа 3
    add_yarn(
        name="Cotton Blend",
        weight_per_skein_g=50.0,
        length_per_skein_m=150.0,
        price_per_skein=350.0,
        composition="50% хлопок, 50% акрил"
    )

    print("Добавляем образцы плотности...")
    # Образец 1: лицевая гладь
    add_sample(
        name="Лицевая гладь (10x10 см)",
        width_cm=10.0,
        height_cm=10.0,
        stitches=20,
        rows=28,
        weight_g=5.0
    )
    # Образец 2: резинка 1x1
    add_sample(
        name="Резинка 1x1 (10x10 см)",
        width_cm=10.0,
        height_cm=10.0,
        stitches=18,
        rows=30,
        weight_g=6.0
    )
    # Образец 3: платочная вязка
    add_sample(
        name="Платочная вязка (10x10 см)",
        width_cm=10.0,
        height_cm=10.0,
        stitches=22,
        rows=26,
        weight_g=7.0
    )

    print("Добавляем проект...")
    # Проект: связан с пряжей Merino Wool и образцом лицевой глади
    pattern_data = {
        "description": "Простой шарф платочной вязкой",
        "dimensions": {"width_cm": 30, "length_cm": 180},
        "needles": 4.5,
        "notes": "Вязать поворотными рядами"
    }
    add_project(
        name="Шарф платочной вязкой",
        pattern_json=pattern_data,
        yarn_id=2,       # Merino Wool
        sample_id=3      # платочная вязка
    )

    print("✅ База данных успешно заполнена демо-данными!")

if __name__ == "__main__":
    main()