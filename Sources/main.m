#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <sqlite3.h>

@interface ZetamacAppDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (assign) sqlite3 *database;
@end

@implementation ZetamacAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self makeMenu];
    [self openDatabase];

    NSRect frame = NSMakeRect(0, 0, 1160, 760);
    self.window = [[NSWindow alloc] initWithContentRect:frame
        styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Zetamac Local";
    self.window.minSize = NSMakeSize(860, 580);
    [self.window center];

    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    [configuration.userContentController addScriptMessageHandler:self name:@"native"];
    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:configuration];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;
    [self.window.contentView addSubview:self.webView];

    NSURL *resourceURL = [[NSBundle mainBundle] resourceURL];
    NSURL *indexURL = [resourceURL URLByAppendingPathComponent:@"index.html"];
    [self.webView loadFileURL:indexURL allowingReadAccessToURL:resourceURL];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)makeMenu {
    NSMenu *bar = [[NSMenu alloc] init];
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [bar addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Zetamac Local"];
    [appMenu addItemWithTitle:@"Quit Zetamac Local" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;
    [NSApp setMainMenu:bar];
}

- (void)openDatabase {
    NSFileManager *files = [NSFileManager defaultManager];
    NSURL *support = [[files URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] firstObject];
    NSURL *directory = [support URLByAppendingPathComponent:@"Zetamac Local" isDirectory:YES];
    NSError *error = nil;
    [files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error];
    if (error) { NSLog(@"Could not create data directory: %@", error); return; }

    NSURL *path = [directory URLByAppendingPathComponent:@"runs.sqlite3"];
    if (sqlite3_open(path.fileSystemRepresentation, &_database) != SQLITE_OK) {
        NSLog(@"Could not open database: %s", sqlite3_errmsg(self.database));
        return;
    }
    const char *schema = "CREATE TABLE IF NOT EXISTS runs ("
        "id TEXT PRIMARY KEY, started_at TEXT NOT NULL, mode TEXT NOT NULL, "
        "duration INTEGER NOT NULL, elapsed REAL NOT NULL, score INTEGER NOT NULL, "
        "settings_json TEXT NOT NULL, questions_json TEXT NOT NULL);"
        "CREATE INDEX IF NOT EXISTS runs_started_at ON runs(started_at DESC);";
    char *message = NULL;
    if (sqlite3_exec(self.database, schema, NULL, NULL, &message) != SQLITE_OK) {
        NSLog(@"Could not initialize database: %s", message ?: "unknown error");
        sqlite3_free(message);
    }
}

- (NSString *)JSONString:(id)object {
    if (!object || ![NSJSONSerialization isValidJSONObject:object]) return @"{}";
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"{}";
}

- (id)JSONValue:(NSString *)string fallback:(id)fallback {
    NSData *data = [string dataUsingEncoding:NSUTF8StringEncoding];
    if (!data) return fallback;
    id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return value ?: fallback;
}

- (void)send:(NSDictionary *)event {
    if (![NSJSONSerialization isValidJSONObject:event]) return;
    NSString *json = [self JSONString:event];
    NSString *script = [NSString stringWithFormat:@"window.zetamacNativeReceive(%@)", json];
    [self.webView evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
        if (error) NSLog(@"JavaScript message failed: %@", error);
    }];
}

- (void)sendRuns {
    if (!self.database) { [self send:@{ @"type": @"error", @"message": @"Local database is unavailable." }]; return; }
    NSMutableArray *runs = [NSMutableArray array];
    sqlite3_stmt *statement = NULL;
    const char *query = "SELECT id, started_at, mode, duration, elapsed, score, settings_json, questions_json FROM runs ORDER BY started_at DESC";
    if (sqlite3_prepare_v2(self.database, query, -1, &statement, NULL) == SQLITE_OK) {
        while (sqlite3_step(statement) == SQLITE_ROW) {
            NSString *(^column)(int) = ^NSString *(int index) {
                const unsigned char *value = sqlite3_column_text(statement, index);
                return value ? [NSString stringWithUTF8String:(const char *)value] : @"";
            };
            [runs addObject:@{
                @"id": column(0), @"startedAt": column(1), @"mode": column(2),
                @"duration": @(sqlite3_column_int(statement, 3)),
                @"elapsed": @(sqlite3_column_double(statement, 4)),
                @"score": @(sqlite3_column_int(statement, 5)),
                @"settings": [self JSONValue:column(6) fallback:@{}],
                @"questions": [self JSONValue:column(7) fallback:@[]],
            }];
        }
    }
    sqlite3_finalize(statement);
    [self send:@{ @"type": @"runs", @"runs": runs }];
}

- (void)saveRun:(NSDictionary *)run {
    if (!self.database) { [self send:@{ @"type": @"error", @"message": @"Local database is unavailable." }]; return; }
    NSString *identifier = run[@"id"];
    NSString *startedAt = run[@"startedAt"];
    NSString *mode = run[@"mode"];
    NSDictionary *settings = run[@"settings"];
    NSArray *questions = run[@"questions"];
    if (![identifier isKindOfClass:NSString.class] || ![startedAt isKindOfClass:NSString.class] ||
        ![mode isKindOfClass:NSString.class] || ![settings isKindOfClass:NSDictionary.class] ||
        ![questions isKindOfClass:NSArray.class]) {
        [self send:@{ @"type": @"error", @"message": @"The run could not be saved because its data was incomplete." }];
        return;
    }
    const char *query = "INSERT OR REPLACE INTO runs (id, started_at, mode, duration, elapsed, score, settings_json, questions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, query, -1, &statement, NULL) != SQLITE_OK) return;
    sqlite3_destructor_type transient = (sqlite3_destructor_type)-1;
    sqlite3_bind_text(statement, 1, identifier.UTF8String, -1, transient);
    sqlite3_bind_text(statement, 2, startedAt.UTF8String, -1, transient);
    sqlite3_bind_text(statement, 3, mode.UTF8String, -1, transient);
    sqlite3_bind_int(statement, 4, [run[@"duration"] intValue]);
    sqlite3_bind_double(statement, 5, [run[@"elapsed"] doubleValue]);
    sqlite3_bind_int(statement, 6, [run[@"score"] intValue]);
    sqlite3_bind_text(statement, 7, [self JSONString:settings].UTF8String, -1, transient);
    sqlite3_bind_text(statement, 8, [self JSONString:questions].UTF8String, -1, transient);
    int result = sqlite3_step(statement);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) {
        [self send:@{ @"type": @"error", @"message": @"Could not save this run to the local database." }];
        return;
    }
    [self send:@{ @"type": @"saved", @"id": identifier }];
    [self sendRuns];
}

- (void)deleteRunWithID:(NSString *)identifier {
    if (!self.database || ![identifier isKindOfClass:NSString.class] || identifier.length == 0) {
        [self send:@{ @"type": @"error", @"message": @"Could not delete this run." }];
        return;
    }
    sqlite3_stmt *statement = NULL;
    const char *query = "DELETE FROM runs WHERE id = ?";
    if (sqlite3_prepare_v2(self.database, query, -1, &statement, NULL) != SQLITE_OK) {
        [self send:@{ @"type": @"error", @"message": @"Could not delete this run." }];
        return;
    }
    sqlite3_destructor_type transient = (sqlite3_destructor_type)-1;
    sqlite3_bind_text(statement, 1, identifier.UTF8String, -1, transient);
    int result = sqlite3_step(statement);
    int deleted = sqlite3_changes(self.database);
    sqlite3_finalize(statement);
    if (result != SQLITE_DONE) {
        [self send:@{ @"type": @"error", @"message": @"Could not delete this run." }];
        return;
    }
    if (deleted == 0) {
        [self send:@{ @"type": @"error", @"message": @"This run was already removed." }];
        [self sendRuns];
        return;
    }
    [self send:@{ @"type": @"deleted", @"count": @1 }];
    [self sendRuns];
}

- (void)deleteAllRuns {
    if (!self.database) {
        [self send:@{ @"type": @"error", @"message": @"Local database is unavailable." }];
        return;
    }
    char *message = NULL;
    int result = sqlite3_exec(self.database, "DELETE FROM runs", NULL, NULL, &message);
    if (result != SQLITE_OK) {
        NSLog(@"Could not delete history: %s", message ?: "unknown error");
        sqlite3_free(message);
        [self send:@{ @"type": @"error", @"message": @"Could not delete run history." }];
        return;
    }
    [self send:@{ @"type": @"deletedAll" }];
    [self sendRuns];
}

- (void)exportCSV:(NSDictionary *)payload {
    NSString *content = payload[@"content"];
    if (![content isKindOfClass:NSString.class]) return;
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = @"zetamac-history.csv";
    panel.allowedContentTypes = @[[UTType typeWithFilenameExtension:@"csv"]];
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
        if (response != NSModalResponseOK) return;
        NSError *error = nil;
        [content writeToURL:panel.URL atomically:YES encoding:NSUTF8StringEncoding error:&error];
        [self send:error ? @{ @"type": @"error", @"message": error.localizedDescription } : @{ @"type": @"exported" }];
    }];
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *body = message.body;
    NSString *type = body[@"type"];
    if ([type isEqualToString:@"ready"] || [type isEqualToString:@"loadRuns"]) [self sendRuns];
    else if ([type isEqualToString:@"saveRun"] && [body[@"run"] isKindOfClass:NSDictionary.class]) [self saveRun:body[@"run"]];
    else if ([type isEqualToString:@"deleteRun"] && [body[@"id"] isKindOfClass:NSString.class]) [self deleteRunWithID:body[@"id"]];
    else if ([type isEqualToString:@"deleteAllRuns"]) [self deleteAllRuns];
    else if ([type isEqualToString:@"exportCSV"] && [body[@"payload"] isKindOfClass:NSDictionary.class]) [self exportCSV:body[@"payload"]];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }
- (void)applicationWillTerminate:(NSNotification *)notification { if (self.database) sqlite3_close(self.database); }
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        application.activationPolicy = NSApplicationActivationPolicyRegular;
        ZetamacAppDelegate *delegate = [[ZetamacAppDelegate alloc] init];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
