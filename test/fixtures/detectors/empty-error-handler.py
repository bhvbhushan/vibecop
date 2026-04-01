# === Should be flagged ===

# except with only pass
try:
    risky_operation()
except:
    pass

# except Exception with only pass
try:
    risky_operation()
except Exception as e:
    pass

# except with only print
try:
    risky_operation()
except Exception as e:
    print(e)

# === Should NOT be flagged ===

# except with comment and pass
try:
    risky_operation()
except Exception as e:
    # intentionally empty
    pass

# Re-raises the error
try:
    risky_operation()
except Exception as e:
    raise ValueError("failed")

# Has recovery logic
try:
    risky_operation()
except Exception as e:
    return fallback_value

# Multiple statements
try:
    risky_operation()
except Exception as e:
    cleanup()
    raise


def risky_operation():
    pass

def cleanup():
    pass

fallback_value = None
