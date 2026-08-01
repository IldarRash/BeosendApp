-- Reconstruct the June and July 2026 planner views from group trainings that
-- already exist. This is provenance-only: the linked training remains the
-- source of truth for lifecycle, visibility, attendance, bookings and money.
--
-- Actor 0 means "system migration". Approval/publication actors stay NULL so
-- the import is not attributed to an arbitrary manager.
DO $$
DECLARE
	v_year integer;
	v_month integer;
	v_from date;
	v_to date;
	v_plan_id uuid;
BEGIN
	FOR v_year, v_month IN
		SELECT * FROM (VALUES (2026, 6), (2026, 7)) AS target_months("year", "month")
	LOOP
		v_from := make_date(v_year, v_month, 1);
		v_to := (v_from + INTERVAL '1 month')::date;

		-- Never merge historical rows into a plan that a manager already created.
		IF EXISTS (
			SELECT 1
			FROM "monthly_schedule_plans"
			WHERE "year" = v_year AND "month" = v_month
		) THEN
			CONTINUE;
		END IF;

		-- Do not create an empty historical plan.
		IF NOT EXISTS (
			SELECT 1
			FROM "trainings"
			WHERE "group_id" IS NOT NULL
				AND "date" >= v_from
				AND "date" < v_to
				AND "monthly_schedule_entry_id" IS NULL
		) THEN
			CONTINUE;
		END IF;

		INSERT INTO "monthly_schedule_plans" (
			"year",
			"month",
			"timezone",
			"status",
			"revision",
			"approved_revision",
			"generated_revision",
			"generated_at",
			"approved_at",
			"published_at",
			"created_by",
			"updated_by"
		) VALUES (
			v_year,
			v_month,
			'Europe/Belgrade',
			'published',
			1,
			1,
			1,
			now(),
			now(),
			now(),
			0,
			0
		)
		RETURNING "id" INTO v_plan_id;

		-- The planner model permits one entry per group and date. Legacy duplicate
		-- rows, if any, remain untouched; prefer the active/current row for the
		-- calendar while preserving every duplicate in the training ledger.
		WITH ranked_trainings AS (
			SELECT
				"trainings".*,
				row_number() OVER (
					PARTITION BY "group_id", "date"
					ORDER BY
						CASE "status"
							WHEN 'completed' THEN 1
							WHEN 'full' THEN 2
							WHEN 'open' THEN 3
							WHEN 'cancelled' THEN 4
						END,
						"id"
				) AS calendar_rank
			FROM "trainings"
			WHERE "group_id" IS NOT NULL
				AND "date" >= v_from
				AND "date" < v_to
				AND "monthly_schedule_entry_id" IS NULL
		),
		calendar_trainings AS (
			SELECT * FROM ranked_trainings WHERE calendar_rank = 1
		),
		weekdays AS (
			SELECT "group_id", array_agg(weekday ORDER BY weekday) AS "days_of_week"
			FROM (
				SELECT DISTINCT
					"group_id",
					EXTRACT(ISODOW FROM "date")::integer AS weekday
				FROM calendar_trainings
			) AS distinct_weekdays
			GROUP BY "group_id"
		),
		schedules AS (
			SELECT
				"group_id",
				"start_time",
				"end_time",
				"trainer_id",
				row_number() OVER (
					PARTITION BY "group_id"
					ORDER BY count(*) DESC, "start_time", "end_time", "trainer_id"
				) AS schedule_rank
			FROM calendar_trainings
			GROUP BY "group_id", "start_time", "end_time", "trainer_id"
		)
		INSERT INTO "monthly_schedule_templates" (
			"plan_id",
			"group_id",
			"days_of_week",
			"start_time",
			"end_time",
			"trainer_id",
			"preferred_court_id"
		)
		SELECT
			v_plan_id,
			schedules."group_id",
			weekdays."days_of_week",
			schedules."start_time",
			schedules."end_time",
			schedules."trainer_id",
			"groups"."court_id"
		FROM schedules
		INNER JOIN weekdays ON weekdays."group_id" = schedules."group_id"
		INNER JOIN "groups" ON "groups"."id" = schedules."group_id"
		WHERE schedules.schedule_rank = 1;

		WITH ranked_trainings AS (
			SELECT
				"trainings".*,
				row_number() OVER (
					PARTITION BY "group_id", "date"
					ORDER BY
						CASE "status"
							WHEN 'completed' THEN 1
							WHEN 'full' THEN 2
							WHEN 'open' THEN 3
							WHEN 'cancelled' THEN 4
						END,
						"id"
				) AS calendar_rank
			FROM "trainings"
			WHERE "group_id" IS NOT NULL
				AND "date" >= v_from
				AND "date" < v_to
				AND "monthly_schedule_entry_id" IS NULL
		)
		INSERT INTO "monthly_schedule_entries" (
			"template_id",
			"date",
			"start_time",
			"end_time",
			"trainer_id",
			"preferred_court_id",
			"assigned_court_id"
		)
		SELECT
			"monthly_schedule_templates"."id",
			ranked_trainings."date",
			ranked_trainings."start_time",
			ranked_trainings."end_time",
			ranked_trainings."trainer_id",
			"groups"."court_id",
			COALESCE("court_blocks"."court_id", "groups"."court_id")
		FROM ranked_trainings
		INNER JOIN "monthly_schedule_templates"
			ON "monthly_schedule_templates"."plan_id" = v_plan_id
			AND "monthly_schedule_templates"."group_id" = ranked_trainings."group_id"
		INNER JOIN "groups" ON "groups"."id" = ranked_trainings."group_id"
		LEFT JOIN "court_blocks" ON "court_blocks"."group_training_id" = ranked_trainings."id"
		WHERE ranked_trainings.calendar_rank = 1;

		WITH ranked_trainings AS (
			SELECT
				"id",
				"group_id",
				"date",
				row_number() OVER (
					PARTITION BY "group_id", "date"
					ORDER BY
						CASE "status"
							WHEN 'completed' THEN 1
							WHEN 'full' THEN 2
							WHEN 'open' THEN 3
							WHEN 'cancelled' THEN 4
						END,
						"id"
				) AS calendar_rank
			FROM "trainings"
			WHERE "group_id" IS NOT NULL
				AND "date" >= v_from
				AND "date" < v_to
				AND "monthly_schedule_entry_id" IS NULL
		)
		UPDATE "trainings"
		SET "monthly_schedule_entry_id" = "monthly_schedule_entries"."id"
		FROM ranked_trainings
		INNER JOIN "monthly_schedule_templates"
			ON "monthly_schedule_templates"."plan_id" = v_plan_id
			AND "monthly_schedule_templates"."group_id" = ranked_trainings."group_id"
		INNER JOIN "monthly_schedule_entries"
			ON "monthly_schedule_entries"."template_id" = "monthly_schedule_templates"."id"
			AND "monthly_schedule_entries"."date" = ranked_trainings."date"
		WHERE "trainings"."id" = ranked_trainings."id"
			AND ranked_trainings.calendar_rank = 1;
	END LOOP;
END $$;
