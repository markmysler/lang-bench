-- The table every server reads (docs/SPEC.md). The seed makes it the same on every machine.
CREATE TABLE world (id integer PRIMARY KEY, randomnumber integer NOT NULL);
SELECT setseed(0.42);
INSERT INTO world (id, randomnumber)
SELECT i, 1 + floor(random() * 10000)::integer FROM generate_series(1, 10000) AS i;
ANALYZE world;
