"""
Root URL configuration for ERO Hub.

All application URLs are delegated to employers/urls.py.
Django admin lives at /admin/.
Auth (login/logout) is handled here using Django's built-in views.
"""

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),

    # Django's built-in login/logout views.
    # login.html template lives in employers/templates/employers/login.html.
    path('login/', auth_views.LoginView.as_view(
        template_name='employers/login.html',
        redirect_authenticated_user=True,
    ), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),

    # All other routes handled by the employers app.
    path('', include('employers.urls')),
]

# Serve media files (CSV uploads) during development.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
