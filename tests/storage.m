#define main zetamac_app_main
#import "../Sources/main.m"
#undef main

static int rowCount(sqlite3 *database) {
    sqlite3_stmt *statement = NULL;
    sqlite3_prepare_v2(database, "SELECT COUNT(*) FROM runs", -1, &statement, NULL);
    int count = sqlite3_step(statement) == SQLITE_ROW ? sqlite3_column_int(statement, 0) : -1;
    sqlite3_finalize(statement);
    return count;
}

int main(void) {
    @autoreleasepool {
        sqlite3 *database = NULL;
        if (sqlite3_open(":memory:", &database) != SQLITE_OK) return 1;
        const char *setup = "CREATE TABLE runs (id TEXT PRIMARY KEY, started_at TEXT, mode TEXT, duration INTEGER, elapsed REAL, score INTEGER, settings_json TEXT, questions_json TEXT);"
            "INSERT INTO runs (id) VALUES ('first'), ('second');";
        if (sqlite3_exec(database, setup, NULL, NULL, NULL) != SQLITE_OK) return 2;

        ZetamacAppDelegate *app = [[ZetamacAppDelegate alloc] init];
        app.database = database;
        [app deleteRunWithID:@"first"];
        if (rowCount(database) != 1) return 3;

        sqlite3_stmt *statement = NULL;
        sqlite3_prepare_v2(database, "SELECT id FROM runs", -1, &statement, NULL);
        BOOL secondRemains = sqlite3_step(statement) == SQLITE_ROW && strcmp((const char *)sqlite3_column_text(statement, 0), "second") == 0;
        sqlite3_finalize(statement);
        if (!secondRemains) return 4;

        [app deleteRunWithID:@"missing"];
        if (rowCount(database) != 1) return 5;
        [app deleteAllRuns];
        if (rowCount(database) != 0) return 6;
        app.database = NULL;
        sqlite3_close(database);
        puts("Native deletion tests passed.");
    }
    return 0;
}
