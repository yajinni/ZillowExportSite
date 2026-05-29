import sys
import os
import json
import time
import subprocess
import threading
import webbrowser
import tkinter as tk
from tkinter import ttk, messagebox
from PIL import Image, ImageDraw
import pystray

# Path configs
CONFIG_PATH = os.path.expanduser("~/.zillow_tray_config.json")
LIVE_URL = "https://zillowexport.pages.dev"

# Platform helper
IS_WINDOWS = sys.platform.startswith("win")

# ----------------------------------------------------
# SYSTEM STARTUP HELPERS
# ----------------------------------------------------
def get_startup_status():
    if IS_WINDOWS:
        import winreg
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ)
            winreg.QueryValueEx(key, "ZillowVaultMonitor")
            winreg.CloseKey(key)
            return True
        except OSError:
            return False
    else:
        plist_path = os.path.expanduser("~/Library/LaunchAgents/com.zillow.vault.monitor.plist")
        return os.path.exists(plist_path)

def set_startup(enable=True):
    if IS_WINDOWS:
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        if enable:
            try:
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
                if getattr(sys, 'frozen', False):
                    cmd = sys.executable
                else:
                    cmd = f'"{sys.executable}" "{os.path.realpath(__file__)}"'
                winreg.SetValueEx(key, "ZillowVaultMonitor", 0, winreg.REG_SZ, cmd)
                winreg.CloseKey(key)
                return True
            except OSError as e:
                print("Error adding to Windows startup registry:", e)
                return False
        else:
            try:
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_ALL_ACCESS)
                winreg.DeleteValue(key, "ZillowVaultMonitor")
                winreg.CloseKey(key)
                return True
            except OSError:
                return False
    else:
        plist_path = os.path.expanduser("~/Library/LaunchAgents/com.zillow.vault.monitor.plist")
        if enable:
            if getattr(sys, 'frozen', False):
                program_args = [sys.executable]
            else:
                program_args = [sys.executable, os.path.realpath(__file__)]
                
            args_xml = "".join(f"        <string>{arg}</string>\n" for arg in program_args)
            plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zillow.vault.monitor</string>
    <key>ProgramArguments</key>
    <array>
{args_xml}    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"""
            try:
                os.makedirs(os.path.dirname(plist_path), exist_ok=True)
                with open(plist_path, "w") as f:
                    f.write(plist_content)
                return True
            except OSError as e:
                print("Error writing macOS launchd plist:", e)
                return False
        else:
            try:
                if os.path.exists(plist_path):
                    os.remove(plist_path)
                return True
            except OSError:
                return False

# ----------------------------------------------------
# CONFIGURATION IO
# ----------------------------------------------------
def read_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                config = json.load(f)
                # Fallback defaults if keys are missing
                if "monitored_projects" not in config:
                    config["monitored_projects"] = ["zillowexport"]
                if "check_interval" not in config:
                    config["check_interval"] = 20
                return config
        except Exception:
            pass
    return {"monitored_projects": ["zillowexport"], "check_interval": 20}

def write_config(config):
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=4)
        return True
    except Exception:
        return False

# ----------------------------------------------------
# CUSTOM PREMIUM SETTINGS GUI (TKINTER)
# ----------------------------------------------------
class SettingsGUI:
    def __init__(self, on_save_callback=None):
        self.on_save_callback = on_save_callback
        self.root = tk.Tk()
        self.root.title("Cloudflare Pages Build Monitor Settings")
        self.root.geometry("480x560")
        self.root.resizable(False, False)
        
        # Sleek dark-mode styling variables
        self.bg_color = "#0B0F19"
        self.card_color = "#111827"
        self.text_color = "#F9FAFB"
        self.text_muted = "#9CA3AF"
        self.accent_color = "#06B6D4"
        self.border_color = "#1F2937"
        
        self.root.configure(bg=self.bg_color)
        
        # Load local settings
        self.config = read_config()
        self.selected_projects = set(self.config.get("monitored_projects", []))
        self.check_interval_var = tk.StringVar(value=str(self.config.get("check_interval", 20)))
        self.startup_var = tk.BooleanVar(value=get_startup_status())
        
        self.projects_list = []
        self.checkbox_vars = {}
        
        self.create_widgets()
        
        # Fetch pages projects asynchronously in the background so UI stays alive!
        threading.Thread(target=self.fetch_cloudflare_projects, daemon=True).start()

    def create_widgets(self):
        # Header Label
        header_frame = tk.Frame(self.root, bg=self.bg_color, pady=15)
        header_frame.pack(fill="x", padx=20)
        
        title_label = tk.Label(
            header_frame, 
            text="Zillow Vault Monitor Settings", 
            font=("Outfit", 14, "bold"), 
            bg=self.bg_color, 
            fg=self.accent_color
        )
        title_label.pack(anchor="w")
        
        desc_label = tk.Label(
            header_frame, 
            text="Manage project notifications, refresh speed, and startup options.", 
            font=("Outfit", 9), 
            bg=self.bg_color, 
            fg=self.text_muted,
            wraplength=440,
            justify="left"
        )
        desc_label.pack(anchor="w", pady=4)

        # Projects List Card Container
        list_label = tk.Label(
            self.root, 
            text="SELECT MONITORED PROJECTS", 
            font=("Outfit", 8, "bold"), 
            bg=self.bg_color, 
            fg=self.text_muted
        )
        list_label.pack(anchor="w", padx=20, pady=(10, 2))

        self.list_card = tk.Frame(self.root, bg=self.card_color, bd=1, relief="flat", highlightbackground=self.border_color, highlightthickness=1)
        self.list_card.pack(fill="both", expand=True, padx=20, pady=5)
        
        # Loading Indicator inside project card list
        self.loading_label = tk.Label(
            self.list_card, 
            text="🔄 Fetching Cloudflare Pages projects...\n(Uses local secure Wrangler OAuth login)", 
            font=("Outfit", 10), 
            bg=self.card_color, 
            fg=self.text_muted,
            justify="center",
            pady=80
        )
        self.loading_label.pack(fill="both", expand=True)

        # Bottom Options Container Card
        options_card = tk.Frame(self.root, bg=self.card_color, bd=1, relief="flat", highlightbackground=self.border_color, highlightthickness=1)
        options_card.pack(fill="x", padx=20, pady=10)
        
        # Check Interval option
        interval_frame = tk.Frame(options_card, bg=self.card_color, pady=8)
        interval_frame.pack(fill="x", padx=15)
        
        interval_lbl = tk.Label(
            interval_frame, 
            text="Check interval (seconds):", 
            font=("Outfit", 10), 
            bg=self.card_color, 
            fg=self.text_color
        )
        interval_lbl.pack(side="left")
        
        interval_entry = tk.Entry(
            interval_frame, 
            textvariable=self.check_interval_var, 
            width=6, 
            font=("Outfit", 10), 
            bg=self.bg_color, 
            fg=self.text_color, 
            insertbackground=self.text_color,
            relief="flat",
            bd=3,
            justify="center"
        )
        interval_entry.pack(side="right")

        # Startup option
        startup_frame = tk.Frame(options_card, bg=self.card_color, pady=8)
        startup_frame.pack(fill="x", padx=15)
        
        startup_cb = tk.Checkbutton(
            startup_frame, 
            text="Launch application on system startup", 
            variable=self.startup_var, 
            font=("Outfit", 10),
            bg=self.card_color, 
            fg=self.text_color,
            selectcolor=self.card_color,
            activebackground=self.card_color,
            activeforeground=self.text_color,
            relief="flat"
        )
        startup_cb.pack(side="left")

        # Buttons Panel
        buttons_frame = tk.Frame(self.root, bg=self.bg_color, pady=15)
        buttons_frame.pack(fill="x", padx=20, side="bottom")
        
        cancel_btn = tk.Button(
            buttons_frame, 
            text="Cancel", 
            font=("Outfit", 10, "bold"), 
            bg=self.card_color, 
            fg=self.text_color, 
            activebackground=self.border_color,
            activeforeground=self.text_color,
            relief="flat",
            bd=0,
            padx=20,
            pady=8,
            cursor="hand2",
            command=self.root.destroy
        )
        cancel_btn.pack(side="left")
        
        save_btn = tk.Button(
            buttons_frame, 
            text="Save & Start Monitoring", 
            font=("Outfit", 10, "bold"), 
            bg=self.accent_color, 
            fg=self.bg_color, 
            activebackground="#0891b2",
            activeforeground=self.bg_color,
            relief="flat",
            bd=0,
            padx=20,
            pady=8,
            cursor="hand2",
            command=self.save_settings
        )
        save_btn.pack(side="right")
        
        # Add modern hover states to buttons
        cancel_btn.bind("<Enter>", lambda e: cancel_btn.configure(bg=self.border_color))
        cancel_btn.bind("<Leave>", lambda e: cancel_btn.configure(bg=self.card_color))
        save_btn.bind("<Enter>", lambda e: save_btn.configure(bg="#22d3ee"))
        save_btn.bind("<Leave>", lambda e: save_btn.configure(bg=self.accent_color))

    def fetch_cloudflare_projects(self):
        try:
            # Query wrangler silently for the project list in JSON format
            cmd = 'npx wrangler pages project list --json'
            result = subprocess.run(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            if result.returncode == 0:
                projects_data = json.loads(result.stdout)
                # Map array elements to project names
                self.projects_list = [p.get('name') for p in projects_data if p.get('name')]
            else:
                self.projects_list = ["zillowexport"] # Fallback if fetch fails (e.g. offline)
        except Exception:
            self.projects_list = ["zillowexport"]
            
        # Draw project list on UI main thread
        self.root.after(0, self.render_projects_list)

    def render_projects_list(self):
        self.loading_label.pack_forget()
        
        # Create scrollable canvas/listbox structure inside list card
        canvas = tk.Canvas(self.list_card, bg=self.card_color, bd=0, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self.list_card, orient="vertical", command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg=self.card_color)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw", width=420)
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # Add the checklist of fetched pages projects
        for project in self.projects_list:
            is_checked = project in self.selected_projects
            var = tk.BooleanVar(value=is_checked)
            self.checkbox_vars[project] = var
            
            row = tk.Frame(scrollable_frame, bg=self.card_color, pady=4)
            row.pack(fill="x", padx=15, anchor="w")
            
            cb = tk.Checkbutton(
                row, 
                text=project, 
                variable=var, 
                font=("Outfit", 10),
                bg=self.card_color, 
                fg=self.text_color,
                selectcolor=self.card_color,
                activebackground=self.card_color,
                activeforeground=self.text_color,
                relief="flat"
            )
            cb.pack(side="left")
            
        canvas.pack(side="left", fill="both", expand=True, padx=5, pady=5)
        if len(self.projects_list) > 6:
            scrollbar.pack(side="right", fill="y", pady=5)

    def save_settings(self):
        # Validate interval input
        try:
            interval = int(self.check_interval_var.get())
            if interval < 5:
                raise ValueError("Check interval must be at least 5 seconds to avoid API rate limits.")
        except ValueError as e:
            messagebox.showerror("Invalid Input", str(e) or "Please enter a valid number of seconds.")
            return

        # Gather selected checklist projects
        monitored = [proj for proj, var in self.checkbox_vars.items() if var.get()]
        if not monitored:
            messagebox.showerror("Error", "Please select at least one Cloudflare Pages project to monitor.")
            return

        # Write to JSON
        self.config["monitored_projects"] = monitored
        self.config["check_interval"] = interval
        write_config(self.config)
        
        # Manage Startup configuration Registry / Plist
        set_startup(self.startup_var.get())
        
        self.root.destroy()
        
        # Trigger parent callback to reload configurations in monitor loop
        if self.on_save_callback:
            self.on_save_callback()

    def start(self):
        self.root.mainloop()

# ----------------------------------------------------
# MAIN SYSTEM TRAY APPLICATION CORE
# ----------------------------------------------------
class ZillowVaultMonitorApp:
    def __init__(self):
        self.running = True
        self.icon = None
        self.monitored_projects = []
        self.check_interval = 20
        self.last_deploy_ids = {} # key: project_name, value: last_checked_id
        self.project_statuses = {} # key: project_name, value: success/building/failed/offline
        
        self.load_settings()

    def load_settings(self):
        config = read_config()
        self.monitored_projects = config.get("monitored_projects", ["zillowexport"])
        self.check_interval = config.get("check_interval", 20)
        
        # Initialize dictionary structures
        for proj in self.monitored_projects:
            if proj not in self.project_statuses:
                self.project_statuses[proj] = 'offline'

    def reload_app(self):
        # Reload configuration settings on GUI Save callback
        self.load_settings()
        # Force a check instantly
        threading.Thread(target=self.check_all_projects, daemon=True).start()

    def get_project_deployment(self, project):
        try:
            # Query wrangler silently for the deployment list in JSON format
            cmd = f'npx wrangler pages deployment list --project-name={project} --json'
            result = subprocess.run(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            if result.returncode == 0:
                data = json.loads(result.stdout)
                if isinstance(data, list) and len(data) > 0:
                    latest = data[0]
                    deploy_id = latest.get('id')
                    raw_status = latest.get('status', 'success')
                    
                    commit_hash = "Unknown"
                    if 'commit_hash' in latest:
                        commit_hash = latest['commit_hash'][:7]
                    elif 'short_hash' in latest:
                        commit_hash = latest['short_hash']
                        
                    url = latest.get('url', LIVE_URL)
                    
                    status = 'online'
                    stages = latest.get('stages', [])
                    
                    is_building = False
                    for stage in stages:
                        if stage.get('status') == 'active':
                            is_building = True
                            break
                            
                    if is_building or raw_status == 'in_progress':
                        status = 'building'
                    elif raw_status == 'failed':
                        status = 'failed'
                    elif raw_status in ['success', 'active', 'idle']:
                        status = 'online'
                        
                    return deploy_id, status, commit_hash, url
            return None, 'offline', 'Unknown', LIVE_URL
        except Exception:
            return None, 'offline', 'Unknown', LIVE_URL

    def draw_tray_icon(self, status):
        # Renders the custom dark Z-logo taskbar/menubar icon dynamically
        width = 64
        height = 64
        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        dc = ImageDraw.Draw(image)
        
        # Rounded glassmorphic card backplate
        dc.rounded_rectangle([4, 4, 60, 60], radius=14, fill=(15, 23, 42, 230), outline=(51, 65, 85, 255), width=2)
        
        # Sleek bold Z symbol
        dc.line([(20, 22), (44, 22)], fill=(6, 182, 212, 255), width=6)
        dc.line([(44, 22), (20, 44)], fill=(6, 182, 212, 255), width=6)
        dc.line([(20, 44), (44, 44)], fill=(6, 182, 212, 255), width=6)
        
        # Status glow dot
        dot_color = (156, 163, 175, 255) # Grey
        if status == 'online':
            dot_color = (34, 197, 94, 255) # Green
        elif status == 'building':
            dot_color = (234, 179, 8, 255) # Yellow
        elif status == 'failed':
            dot_color = (239, 68, 68, 255) # Red
            
        dc.ellipse([44, 44, 56, 56], fill=dot_color, outline=(15, 23, 42, 255), width=1)
        return image

    def trigger_wrangler_login(self):
        # Spawns a secure terminal login tab in Brave
        threading.Thread(target=lambda: subprocess.run('npx wrangler login', shell=True)).start()

    def open_settings_window(self):
        # Safely spawn Settings GUI in a standalone thread so pystray's loop doesn't block!
        def run_gui():
            gui = SettingsGUI(on_save_callback=self.reload_app)
            gui.start()
        threading.Thread(target=run_gui, daemon=True).start()

    def update_menu(self):
        # Generate the interactive taskbar menu list
        menu_items = []
        
        # Monitored Projects Section Header
        menu_items.append(pystray.MenuItem("🛰️ Monitored Projects:", lambda: None, enabled=False))
        
        # List each monitored project and its current build state
        for project in self.monitored_projects:
            status = self.project_statuses.get(project, 'offline')
            dot = "🔴"
            status_text = "Disconnected/Error"
            
            if status == 'online':
                dot = "🟢"
                status_text = "Live"
            elif status == 'building':
                dot = "🟡"
                status_text = "Compiling..."
            elif status == 'failed':
                dot = "🔴"
                status_text = "Deploy Failed"
                
            project_label = f"  {dot} {project}: {status_text}"
            menu_items.append(pystray.MenuItem(project_label, lambda: None, enabled=False))
            
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("🌐 Open Zillow Data Vault", lambda: webbrowser.open(LIVE_URL)))
        menu_items.append(pystray.MenuItem("⚙️ Manage Projects & Settings", self.open_settings_window))
        menu_items.append(pystray.MenuItem("⚡ Force Check Now", lambda: threading.Thread(target=self.check_all_projects, daemon=True).start()))
        menu_items.append(pystray.MenuItem("🔑 Re-Authorize Wrangler", self.trigger_wrangler_login))
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("❌ Exit Monitor", self.stop_app))
        
        return pystray.Menu(*menu_items)

    def check_all_projects(self):
        # Check all selected projects in sequence, staggered by 3 seconds
        global_status = 'online'
        any_building = False
        any_failed = False
        
        for project in list(self.monitored_projects):
            if not self.running:
                break
                
            deploy_id, status, commit_hash, url = self.get_project_deployment(project)
            self.project_statuses[project] = status
            
            # Identify status changes and alert user
            last_id = self.last_deploy_ids.get(project)
            if deploy_id and deploy_id != last_id:
                if last_id is not None: # Skip alert on application startup boot
                    if status == 'online':
                        self.icon.notify(
                            f"🎉 Pages Build Live: {project}",
                            f"Build for commit {commit_hash} is complete! Refresh the website to see updates."
                        )
                    elif status == 'failed':
                        self.icon.notify(
                            f"❌ Pages Build Failed: {project}",
                            f"Commit {commit_hash} failed to compile on Cloudflare Pages."
                        )
                    elif status == 'building':
                        self.icon.notify(
                            f"⚙️ Compiling Pages: {project}",
                            f"A new build is compiling in the cloud for commit {commit_hash}."
                        )
                self.last_deploy_ids[project] = deploy_id
                
            if status == 'building':
                any_building = True
            elif status == 'failed':
                any_failed = True
                
            time.sleep(3) # Stagger queries to prevent local API lockups
            
        # Determine global status to show on the taskbar icon
        if any_building:
            global_status = 'building'
        elif any_failed:
            global_status = 'failed'
        elif all(self.project_statuses.get(p) == 'offline' for p in self.monitored_projects):
            global_status = 'offline'
            
        # Re-render tray icon
        if self.icon:
            self.icon.icon = self.draw_tray_icon(global_status)
            self.icon.menu = self.update_menu()

    def monitor_loop(self):
        while self.running:
            self.check_all_projects()
            for _ in range(self.check_interval):
                if not self.running:
                    break
                time.sleep(1)

    def run(self):
        # Open Settings window on very first launch automatically!
        if not os.path.exists(CONFIG_PATH):
            self.open_settings_window()
            
        initial_image = self.draw_tray_icon('offline')
        self.icon = pystray.Icon(
            "zillow_vault_monitor",
            initial_image,
            "Zillow Vault Build Monitor",
            menu=self.update_menu()
        )
        
        # Start background polling thread
        threading.Thread(target=self.monitor_loop, daemon=True).start()
        self.icon.run()

    def stop_app(self):
        self.running = False
        if self.icon:
            self.icon.stop()
        sys.exit(0)

if __name__ == "__main__":
    app = ZillowVaultMonitorApp()
    app.run()
